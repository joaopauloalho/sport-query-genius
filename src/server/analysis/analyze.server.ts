import { COMPETITIONS, type MatchRecord } from "@/data/sports";
import type { AnalysisOverrides, AnalysisRequest } from "@/lib/analysis-request";
import type { QueryIntent } from "@/lib/analysis";
import { ApiFootballProvider } from "@/server/sports/providers/api-football.server";
import { BsdFootballV3Provider } from "@/server/sports/providers/bsd-football-v3.server";
import { FilteredSportsDataProvider } from "@/server/sports/filtered-provider.server";
import type { ProviderFixture, SportsDataProvider } from "@/server/sports/provider";

import { parseIntentWithDeepSeek } from "./deepseek.server";
import { buildRealAnalysisResult } from "./engine.server";
import { AnalysisPipelineError, toSafeAnalysisError, type ServerAnalysisOutcome } from "./errors";
import type { QueryIntentInput } from "./intent-schema";

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

function createFootballProvider(): SportsDataProvider {
  const provider = process.env.BSD_FOOTBALL_KEY
    ? new BsdFootballV3Provider()
    : new ApiFootballProvider();
  return new FilteredSportsDataProvider(provider);
}

function applyOverrides(
  parsedIntent: QueryIntentInput,
  overrides?: AnalysisOverrides,
): QueryIntentInput {
  if (!overrides) return parsedIntent;

  const competitionWasOverridden = Object.prototype.hasOwnProperty.call(
    overrides,
    "competition",
  );

  return {
    ...parsedIntent,
    match_count: overrides.match_count ?? parsedIntent.match_count,
    competition: competitionWasOverridden
      ? (overrides.competition ?? null)
      : parsedIntent.competition,
    venue: overrides.venue ?? parsedIntent.venue,
  };
}

function resolveCompetition(value: string | null): {
  intentValue: string | null;
  providerNames: readonly string[] | null;
} {
  if (value === null) return { intentValue: null, providerNames: null };

  const normalized = normalizeCompetition(value);
  const footballCompetitions = COMPETITIONS.filter((competition) => competition.sport === "football");
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

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

function filterDescription(intent: QueryIntentInput, competition: string | null): string {
  const parts: string[] = [];
  if (intent.venue === "home") parts.push("em casa");
  if (intent.venue === "away") parts.push("fora de casa");
  if (competition) parts.push(`na competição "${competition}"`);
  return parts.length ? ` ${parts.join(" e ")}` : "";
}

export async function analyzeQuestionServer(request: AnalysisRequest): Promise<ServerAnalysisOutcome> {
  try {
    const parsedIntent = await parseIntentWithDeepSeek(request.question);
    const effectiveIntent = applyOverrides(parsedIntent, request.overrides);
    const competition = resolveCompetition(effectiveIntent.competition);

    const provider = createFootballProvider();
    const team = await provider.resolveTeam(effectiveIntent.entity_name);
    const fixtures = await provider.getRecentTeamFixtures(team.id, effectiveIntent.match_count, {
      venue: effectiveIntent.venue,
      competitionNames: competition.providerNames,
    });

    if (fixtures.length < effectiveIntent.match_count) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A ${provider.name} retornou apenas ${fixtures.length} partidas concluídas${filterDescription(effectiveIntent, competition.intentValue)} para a amostra pedida. Nenhuma partida de outro filtro foi usada para completar a amostra.`,
      );
    }

    const selectedFixtures = fixtures.slice(-effectiveIntent.match_count);
    const metricResults = await mapWithConcurrency<ProviderFixture, MatchRecord | null>(
      selectedFixtures,
      4,
      (fixture) => provider.getFixtureMetric(fixture, team.id, effectiveIntent.metric),
    );
    const matches = metricResults.filter((match): match is MatchRecord => match !== null);

    if (matches.length < effectiveIntent.match_count) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A ${provider.name} não forneceu a estatística "${effectiveIntent.metric}" em todas as ${effectiveIntent.match_count} partidas selecionadas. Nenhum valor ausente foi estimado.`,
      );
    }

    const intent: QueryIntent = {
      ...effectiveIntent,
      competition: competition.intentValue,
      entity_name: team.name,
      entity_id: String(team.id),
      metric_label: METRIC_LABELS[effectiveIntent.metric],
      compare_with: null,
    };

    return {
      ok: true,
      result: buildRealAnalysisResult({
        question: request.question,
        intent,
        matches,
        provider: provider.name,
      }),
    };
  } catch (error) {
    const safe = toSafeAnalysisError(error);
    return { ok: false, code: safe.code, reason: safe.reason };
  }
}
