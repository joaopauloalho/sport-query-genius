import { COMPETITIONS } from "@/data/sports";
import type { QueryIntent } from "@/lib/analysis";
import type { AnalysisRequest } from "@/lib/analysis-request";
import { AliasAwareTeamProvider } from "@/server/sports/alias-aware-provider.server";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import {
  getSportsCacheRepository,
  withSportsCache,
} from "@/server/sports/cache/sports-cache.server";
import { resolveFootballCapability } from "@/server/sports/capability-registry";
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
import {
  analyzePhase4cUniversalTeamPlan,
  isPhase4cUniversalTeamPlan,
} from "./analyze-team-universal.server";
import { analyzeUniversalQueryPlan, isPhase4bUniversalPlan } from "./analyze-universal.server";
import { parseUniversalQueryPlanWithDeepSeek } from "./deepseek-v4c.server";
import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError, toSafeAnalysisError, type AnalysisPipelineOutcome } from "./errors";
import type { TeamAggregateIntentInput } from "./intent-schema";
import { applyOverrides } from "./overrides";
import { queryPlanToLegacyIntent } from "./query-plan-adapter";

const METRIC_LABELS = {
  corners: "Escanteios",
  goals: "Gols marcados",
  shots: "Finalizações",
  shots_on_target: "Finalizações no alvo",
  cards: "Cartões",
} as const;

const COMPETITION_ALIASES: Record<string, readonly string[]> = {
  brasileirao: [
    "Brasileirão Série A",
    "Brasileirao Serie A",
    "Brasileirão",
    "Brasileirao",
    "Campeonato Brasileiro Série A",
    "Campeonato Brasileiro Serie A",
    "Brazilian Serie A",
  ],
  laliga: ["La Liga", "LaLiga", "Primera División", "Primera Division"],
  premier: ["Premier League"],
  ucl: ["UEFA Champions League", "Champions League"],
};

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
  const normalized = normalizeCompetition(value);
  const footballCompetitions = COMPETITIONS.filter(
    (competition) => competition.sport === "football",
  );
  const known = footballCompetitions.find((competition) => {
    if (normalizeCompetition(competition.id) === normalized) return true;
    if (normalizeCompetition(competition.name) === normalized) return true;
    return (COMPETITION_ALIASES[competition.id] ?? []).some(
      (alias) => normalizeCompetition(alias) === normalized,
    );
  });
  if (!known) return { intentValue: value, providerNames: [value] };
  const aliases = COMPETITION_ALIASES[known.id] ?? [known.name];
  return {
    intentValue: known.id,
    providerNames: Array.from(new Set([known.name, ...aliases])),
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
    const queryPlan = await parseUniversalQueryPlanWithDeepSeek(request.question);
    const capability = resolveFootballCapability(queryPlan);
    if (!capability.supported) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        capability.reason ?? "A combinação solicitada não está registrada no motor universal.",
      );
    }

    // Phase 4C owns team aggregate/match-list semantics. It runs before the legacy stage gate
    // because several score-derived metrics were intentionally marked "planned" only while
    // the legacy 1/3/5/10/15/20 adapter was still the executor.
    if (isPhase4cUniversalTeamPlan(queryPlan)) {
      const result = await analyzePhase4cUniversalTeamPlan({
        question: request.question,
        plan: queryPlan,
        overrides: request.overrides,
        observer,
      });
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
          `Filtros/group_by/sort/limit foram compreendidos, mas ${queryPlan.query_kind} ainda não executa essas operações na Phase 4B.`,
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
      });
      return { ok: true, result };
    }

    if (
      queryPlan.entity.type === "player" &&
      (queryPlan.filters.length || queryPlan.group_by.length || queryPlan.sort || queryPlan.limit)
    ) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        "Filtros, agrupamento, ordenação e limit de apresentação para jogador já fazem parte do QueryPlan, mas ainda não são executados pelo adapter de jogador desta subfase.",
      );
    }

    const parsedIntent = queryPlanToLegacyIntent(queryPlan);
    const effectiveIntent = applyOverrides(parsedIntent, request.overrides);
    const competition = resolveCompetition(effectiveIntent.competition);

    if (effectiveIntent.entity_type === "player") {
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

    // Kept as a compatibility fallback for any old team intent not yet routed through Phase 4C.
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
