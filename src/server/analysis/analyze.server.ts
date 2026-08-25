import { COMPETITIONS } from "@/data/sports";
import type { QueryIntent } from "@/lib/analysis";
import type { AnalysisRequest } from "@/lib/analysis-request";
import { AliasAwareTeamProvider } from "@/server/sports/alias-aware-provider.server";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import {
  getSportsCacheRepository,
  withSportsCache,
} from "@/server/sports/cache/sports-cache.server";
import {
  canonicalizeCompetitionName,
  competitionAliases,
} from "@/server/sports/competition-season-registry";
import { FilteredSportsDataProvider } from "@/server/sports/filtered-provider.server";
import { getPhase3dSportsRepository } from "@/server/sports/phase3d-repository.server";
import { FootballProviderOrchestrator } from "@/server/sports/provider-fallback.server";
import type { SportsDataProvider } from "@/server/sports/provider";
import { SafeApiFootballProvider } from "@/server/sports/providers/api-football-safe.server";
import { BsdFootballV3Provider } from "@/server/sports/providers/bsd-football-v3.server";

import {
  analyzePlayerAggregate,
  analyzePlayerEventList,
  type ResolvedCompetitionFilter,
} from "./analyze-player.server";
import { executePlayerAggregate, executePlayerMatchList } from "./analyze-player-universal.server";
import { isPhase4cUniversalTeamPlan } from "./analyze-team-universal.server";
import { analyzeUniversalQueryPlan, isPhase4bUniversalPlan } from "./analyze-universal.server";
import { parseUniversalSemanticPlanWithDeepSeek } from "./deepseek-v5a.server";
import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError, toSafeAnalysisError, type AnalysisPipelineOutcome } from "./errors";
import { buildExecutionPlan } from "./execution-plan";
import type { TeamAggregateIntentInput } from "./intent-schema";
import { applyOverrides } from "./overrides";
import { analyzePhase4cWithFreshnessFallback } from "./phase4c-freshness.server";
import { queryPlanToLegacyIntent } from "./query-plan-adapter";
import { calculateDeterministicTrend } from "./trend";

const METRIC_LABELS = {
  corners: "Escanteios",
  goals: "Gols marcados",
  shots: "Finalizações",
  shots_on_target: "Finalizações no alvo",
  cards: "Cartões",
} as const;

const normalizeCompetition = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function addEntityResolution(
  provider: SportsDataProvider,
  observer?: SportsCacheObserver,
): SportsDataProvider {
  return new AliasAwareTeamProvider(
    withSportsCache(provider, observer),
    getPhase3dSportsRepository(),
    getSportsCacheRepository(),
    observer,
  );
}

function createFootballOrchestrator(observer?: SportsCacheObserver): FootballProviderOrchestrator {
  if (process.env.BSD_FOOTBALL_KEY) {
    return new FootballProviderOrchestrator(
      new FilteredSportsDataProvider(addEntityResolution(new BsdFootballV3Provider(), observer)),
      new FilteredSportsDataProvider(addEntityResolution(new SafeApiFootballProvider(), observer)),
    );
  }
  return new FootballProviderOrchestrator(
    new FilteredSportsDataProvider(addEntityResolution(new SafeApiFootballProvider(), observer)),
  );
}

function resolveCompetition(value: string | null): ResolvedCompetitionFilter {
  if (value === null) return { intentValue: null, providerNames: null };
  const canonical = canonicalizeCompetitionName(value);
  const normalized = normalizeCompetition(canonical);
  const footballCompetitions = COMPETITIONS.filter(
    (competition) => competition.sport === "football",
  );
  const known = footballCompetitions.find(
    (competition) =>
      normalizeCompetition(competition.id) === normalized ||
      normalizeCompetition(competition.name) === normalized ||
      normalizeCompetition(canonicalizeCompetitionName(competition.name)) === normalized,
  );
  if (!known) return { intentValue: canonical, providerNames: [...competitionAliases(canonical)] };
  return {
    intentValue: known.id,
    providerNames: Array.from(
      new Set([known.name, ...competitionAliases(known.name), ...competitionAliases(canonical)]),
    ),
  };
}

function filterDescription(intent: TeamAggregateIntentInput, competition: string | null): string {
  const parts: string[] = [];
  if (intent.venue === "home") parts.push("em casa");
  if (intent.venue === "away") parts.push("fora de casa");
  if (competition) parts.push(`na competição "${competition}"`);
  return parts.length ? ` ${parts.join(" e ")}` : "";
}

export async function analyzeQuestionServer(
  request: AnalysisRequest,
  observer?: SportsCacheObserver,
): Promise<AnalysisPipelineOutcome> {
  try {
    const semanticPlan = await parseUniversalSemanticPlanWithDeepSeek(request.question);
    const executionPlan = buildExecutionPlan(semanticPlan);
    const queryPlan = executionPlan.query_plan;
    const capability = executionPlan.negotiation.capability;
    if (!capability) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        "A capability não pôde ser materializada no ExecutionPlan.",
      );
    }

    if (executionPlan.negotiation.executor === "player_universal_aggregate") {
      const result = await executePlayerAggregate(request.question, queryPlan, request.overrides);
      return { ok: true, result };
    }

    if (executionPlan.negotiation.executor === "player_universal_match_list") {
      const result = await executePlayerMatchList(request.question, queryPlan, request.overrides);
      return { ok: true, result };
    }

    // Phase 5A truth-gates the entire semantic request before any executor is selected.
    if (isPhase4cUniversalTeamPlan(queryPlan)) {
      const result = await analyzePhase4cWithFreshnessFallback({
        question: request.question,
        plan: queryPlan,
        overrides: request.overrides,
        observer,
        allowedProviders: executionPlan.negotiation.providers as ("BSD" | "API-FOOTBALL")[],
      });
      if (result.result_type === "aggregate") {
        result.statistics.trend = calculateDeterministicTrend(
          result.chart_data.map((point) => point.value),
        );
      }
      return { ok: true, result };
    }

    if (isPhase4bUniversalPlan(queryPlan)) {
      if (
        queryPlan.filters.length ||
        queryPlan.group_by.length ||
        queryPlan.sort ||
        queryPlan.limit
      ) {
        throw new AnalysisPipelineError(
          "UNSUPPORTED_CAPABILITY",
          `Filtros/group_by/sort/limit foram compreendidos, mas ${queryPlan.query_kind} ainda não executa essas operações.`,
        );
      }
      if (capability.stage !== "implemented") {
        throw new AnalysisPipelineError(
          "UNSUPPORTED_CAPABILITY",
          capability.reason ??
            "A capability foi compreendida, mas ainda não possui executor determinístico.",
        );
      }
      const result = await analyzeUniversalQueryPlan({
        question: request.question,
        plan: queryPlan,
        overrides: request.overrides,
        observer,
        allowedProviders: executionPlan.negotiation.providers as ("BSD" | "API-FOOTBALL")[],
      });
      return { ok: true, result };
    }

    const parsedIntent = queryPlanToLegacyIntent(queryPlan);
    const effectiveIntent = applyOverrides(parsedIntent, request.overrides);
    const competition = resolveCompetition(effectiveIntent.competition);

    if (effectiveIntent.entity_type === "player") {
      // Goal event_list stays on the proven Phase 3D timeline path. The legacy aggregate branch is
      // retained only as a defensive compatibility fallback; Phase 5C aggregate normally routes above.
      const result =
        effectiveIntent.query_kind === "event_list"
          ? await analyzePlayerEventList({
              question: request.question,
              intent: effectiveIntent,
              competition,
              observer,
            })
          : await analyzePlayerAggregate({
              question: request.question,
              intent: effectiveIntent,
              competition,
              observer,
            });
      return { ok: true, result };
    }

    const orchestrator = createFootballOrchestrator(observer);
    const selection = await orchestrator.selectTeamFixtures(
      effectiveIntent.entity_name,
      effectiveIntent.match_count,
      {
        venue: effectiveIntent.venue,
        competitionNames: competition.providerNames,
      },
    );

    if (selection.fixtures.length < effectiveIntent.match_count) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A ${selection.provider.name} retornou apenas ${selection.fixtures.length} partidas concluídas${filterDescription(effectiveIntent, competition.intentValue)} para a amostra pedida. Nenhuma partida de outro filtro foi usada para completar a amostra.`,
      );
    }

    const selectedFixtures = selection.fixtures.slice(-effectiveIntent.match_count);
    const matches = await orchestrator.getSelectedFixtureMetrics(
      { ...selection, fixtures: selectedFixtures },
      effectiveIntent.metric,
    );
    const intent: QueryIntent = {
      ...effectiveIntent,
      competition: competition.intentValue,
      entity_name: selection.team.name,
      entity_id: String(selection.team.id),
      metric_label: METRIC_LABELS[effectiveIntent.metric],
      compare_with: null,
    };
    const providersUsed = Array.from(new Set(matches.map((match) => match.source)));
    const providerLabel = providersUsed.join(" + ");

    return {
      ok: true,
      result: buildRealAnalysisResult({
        question: request.question,
        intent,
        matches,
        provider: providerLabel,
      }),
    };
  } catch (error) {
    const safe = toSafeAnalysisError(error);
    return {
      ok: false,
      code: safe.code,
      reason: safe.reason,
      ...(safe.candidates ? { candidates: safe.candidates } : {}),
    };
  }
}
