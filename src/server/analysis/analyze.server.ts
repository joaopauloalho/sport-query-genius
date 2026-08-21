import { COMPETITIONS } from "@/data/sports";
import {
  SUPPORTED_MATCH_COUNTS,
  type AnalysisRequest,
  type SupportedMatchCount,
} from "@/lib/analysis-request";
import type { QueryIntent } from "@/lib/analysis";
import { FilteredSportsDataProvider } from "@/server/sports/filtered-provider.server";
import { FootballProviderOrchestrator } from "@/server/sports/provider-fallback.server";
import { ApiFootballProvider } from "@/server/sports/providers/api-football.server";
import { BsdFootballV3Provider } from "@/server/sports/providers/bsd-football-v3.server";

import { parseIntentWithDeepSeek } from "./deepseek.server";
import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError, toSafeAnalysisError, type ServerAnalysisOutcome } from "./errors";
import type { QueryIntentInput } from "./intent-schema";
import { applyOverrides } from "./overrides";

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

function createFootballOrchestrator(): FootballProviderOrchestrator {
  if (process.env.BSD_FOOTBALL_KEY) {
    return new FootballProviderOrchestrator(
      new FilteredSportsDataProvider(new BsdFootballV3Provider()),
      new FilteredSportsDataProvider(new ApiFootballProvider()),
    );
  }

  return new FootballProviderOrchestrator(
    new FilteredSportsDataProvider(new ApiFootballProvider()),
  );
}

function assertSupportedExplicitPeriod(question: string): void {
  const normalized = question
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const matches = normalized.matchAll(/\b(\d{1,3})\s*(?:jogos?|partidas?)\b/g);

  for (const match of matches) {
    const count = Number(match[1]);
    if (!SUPPORTED_MATCH_COUNTS.includes(count as SupportedMatchCount)) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_FILTER",
        `Período de ${count} partidas não suportado. Use exatamente 5, 10, 15 ou 20 partidas.`,
      );
    }
  }
}

function resolveCompetition(value: string | null): {
  intentValue: string | null;
  providerNames: readonly string[] | null;
} {
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

  if (!known) {
    return { intentValue: value, providerNames: [value] };
  }

  const aliases = COMPETITION_ALIASES[known.id] ?? [known.name];
  return {
    intentValue: known.id,
    providerNames: Array.from(new Set([known.name, ...aliases])),
  };
}

function filterDescription(intent: QueryIntentInput, competition: string | null): string {
  const parts: string[] = [];
  if (intent.venue === "home") parts.push("em casa");
  if (intent.venue === "away") parts.push("fora de casa");
  if (competition) parts.push(`na competição "${competition}"`);
  return parts.length ? ` ${parts.join(" e ")}` : "";
}

export async function analyzeQuestionServer(
  request: AnalysisRequest,
): Promise<ServerAnalysisOutcome> {
  try {
    assertSupportedExplicitPeriod(request.question);

    const parsedIntent = await parseIntentWithDeepSeek(request.question);
    const effectiveIntent = applyOverrides(parsedIntent, request.overrides);
    const competition = resolveCompetition(effectiveIntent.competition);

    const orchestrator = createFootballOrchestrator();
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
    return { ok: false, code: safe.code, reason: safe.reason };
  }
}
