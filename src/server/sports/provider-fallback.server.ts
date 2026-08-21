import type { MatchRecord } from "@/data/sports";
import { AnalysisPipelineError } from "../analysis/errors.ts";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type {
  ProviderFixture,
  ResolvedTeam,
  SportsDataProvider,
  TeamFixtureFilters,
} from "./provider";

const METRIC_CONCURRENCY = 4;
const FALLBACK_HISTORY_LIMIT = 120;
const MATCH_TIME_TOLERANCE_SECONDS = 90 * 60;

export interface ProviderSelection {
  provider: SportsDataProvider;
  team: ResolvedTeam;
  fixtures: ProviderFixture[];
  usedFallbackForSelection: boolean;
}

export type FixtureMatchResult =
  | { status: "matched"; fixture: ProviderFixture }
  | { status: "not_found"; candidateIds: number[] }
  | { status: "ambiguous"; candidateIds: number[] };

interface MetricAttempt {
  match: MatchRecord | null;
  error: AnalysisPipelineError | null;
}

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function asProviderError(error: unknown, providerName: string): AnalysisPipelineError {
  if (error instanceof AnalysisPipelineError) return error;
  return new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    `${providerName} falhou ao processar a resposta do serviço de dados esportivos.`,
  );
}

function canFallbackSelection(error: AnalysisPipelineError): boolean {
  return (
    error.code === "TEAM_NOT_FOUND" ||
    error.code === "PROVIDER_UNAVAILABLE" ||
    error.code === "API_LIMIT_REACHED"
  );
}

function combineSelectionErrors(
  primaryName: string,
  primaryError: AnalysisPipelineError,
  fallbackName: string,
  fallbackError: AnalysisPipelineError,
): AnalysisPipelineError {
  const code =
    primaryError.code === "TEAM_NOT_FOUND" && fallbackError.code === "TEAM_NOT_FOUND"
      ? "TEAM_NOT_FOUND"
      : fallbackError.code;

  return new AnalysisPipelineError(
    code,
    `${primaryName}: ${primaryError.message} ${fallbackName} (fallback): ${fallbackError.message}`,
  );
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

export function matchCrossProviderFixture(
  primaryFixture: ProviderFixture,
  fallbackFixtures: readonly ProviderFixture[],
  toleranceSeconds = MATCH_TIME_TOLERANCE_SECONDS,
): FixtureMatchResult {
  const primaryHome = normalize(primaryFixture.home.name);
  const primaryAway = normalize(primaryFixture.away.name);

  const candidates = fallbackFixtures.filter((candidate) => {
    const timeDelta = Math.abs(candidate.timestamp - primaryFixture.timestamp);
    return (
      timeDelta <= toleranceSeconds &&
      normalize(candidate.home.name) === primaryHome &&
      normalize(candidate.away.name) === primaryAway
    );
  });

  if (candidates.length === 0) {
    return { status: "not_found", candidateIds: [] };
  }

  if (candidates.length === 1) {
    return { status: "matched", fixture: candidates[0] };
  }

  const primaryCompetition = normalize(primaryFixture.competition);
  const sameCompetition = candidates.filter(
    (candidate) => normalize(candidate.competition) === primaryCompetition,
  );

  if (sameCompetition.length === 1) {
    return { status: "matched", fixture: sameCompetition[0] };
  }

  return {
    status: "ambiguous",
    candidateIds: candidates.map((candidate) => candidate.id),
  };
}

export class FootballProviderOrchestrator {
  constructor(
    private readonly primary: SportsDataProvider,
    private readonly fallback?: SportsDataProvider,
  ) {}

  private async loadSelection(
    provider: SportsDataProvider,
    teamName: string,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<Omit<ProviderSelection, "usedFallbackForSelection">> {
    const team = await provider.resolveTeam(teamName);
    const fixtures = await provider.getRecentTeamFixtures(team.id, count, filters);
    return { provider, team, fixtures };
  }

  async selectTeamFixtures(
    teamName: string,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<ProviderSelection> {
    console.info("[sports-fallback] primary provider selected", {
      provider: this.primary.name,
      fallback: this.fallback?.name ?? null,
      team: teamName,
    });

    try {
      const selected = await this.loadSelection(this.primary, teamName, count, filters);
      return { ...selected, usedFallbackForSelection: false };
    } catch (rawPrimaryError) {
      const primaryError = asProviderError(rawPrimaryError, this.primary.name);
      if (!this.fallback || !canFallbackSelection(primaryError)) throw primaryError;

      console.warn("[sports-fallback] provider fallback triggered", {
        from: this.primary.name,
        to: this.fallback.name,
        stage: primaryError.code === "TEAM_NOT_FOUND" ? "resolve_team" : "team_or_fixtures",
        reason: primaryError.code,
        detail: primaryError.message,
      });

      try {
        const selected = await this.loadSelection(this.fallback, teamName, count, filters);
        console.info("[sports-fallback] fallback provider selected", {
          provider: this.fallback.name,
          teamId: selected.team.id,
          fixtureCount: selected.fixtures.length,
        });
        return { ...selected, usedFallbackForSelection: true };
      } catch (rawFallbackError) {
        const fallbackError = asProviderError(rawFallbackError, this.fallback.name);
        throw combineSelectionErrors(
          this.primary.name,
          primaryError,
          this.fallback.name,
          fallbackError,
        );
      }
    }
  }

  private async getMetricAttempt(
    provider: SportsDataProvider,
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MetricAttempt> {
    try {
      const match = await provider.getFixtureMetric(fixture, teamId, metric);
      if (match) {
        console.info("[sports-fallback] fixture metric resolved", {
          provider: match.source,
          fixtureId: fixture.id,
          metric,
        });
      }
      return { match, error: null };
    } catch (error) {
      const providerError = asProviderError(error, provider.name);
      console.warn("[sports-fallback] fixture metric failed", {
        provider: provider.name,
        fixtureId: fixture.id,
        metric,
        reason: providerError.code,
        detail: providerError.message,
      });
      return { match: null, error: providerError };
    }
  }

  async getSelectedFixtureMetrics(
    selection: ProviderSelection,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord[]> {
    const attempts = await mapWithConcurrency(selection.fixtures, METRIC_CONCURRENCY, (fixture) =>
      this.getMetricAttempt(selection.provider, fixture, selection.team.id, metric),
    );

    const missingIndexes = attempts
      .map((attempt, index) => (attempt.match === null ? index : -1))
      .filter((index) => index >= 0);

    if (missingIndexes.length === 0) {
      return attempts.map((attempt) => attempt.match as MatchRecord);
    }

    if (selection.provider !== this.primary || !this.fallback) {
      const firstError = missingIndexes
        .map((index) => attempts[index].error)
        .find((error): error is AnalysisPipelineError => error !== null);
      if (firstError) throw firstError;

      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${selection.provider.name} não forneceu a estatística "${metric}" em todas as ${selection.fixtures.length} partidas selecionadas. Nenhuma partida foi substituída e nenhum valor foi estimado.`,
      );
    }

    console.info("[sports-fallback] metric fallback required", {
      from: this.primary.name,
      to: this.fallback.name,
      metric,
      missingFixtureIds: missingIndexes.map((index) => selection.fixtures[index].id),
    });

    let fallbackTeam: ResolvedTeam;
    let fallbackHistory: ProviderFixture[];
    try {
      fallbackTeam = await this.fallback.resolveTeam(selection.team.name);
      fallbackHistory = await this.fallback.getRecentTeamFixtures(
        fallbackTeam.id,
        FALLBACK_HISTORY_LIMIT,
      );
    } catch (error) {
      const fallbackError = asProviderError(error, this.fallback.name);
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${this.primary.name} não forneceu a estatística "${metric}" em ${missingIndexes.length} partida(s) selecionada(s), e o fallback ${this.fallback.name} não pôde reconciliar essas mesmas partidas (${fallbackError.code}: ${fallbackError.message}). Nenhuma partida foi substituída e nenhum valor foi estimado.`,
      );
    }

    const reconciled = [...attempts];

    await mapWithConcurrency(missingIndexes, METRIC_CONCURRENCY, async (index) => {
      const primaryFixture = selection.fixtures[index];
      console.info("[sports-fallback] reconciling fixture", {
        primaryProvider: this.primary.name,
        fallbackProvider: this.fallback?.name ?? null,
        primaryFixtureId: primaryFixture.id,
        date: primaryFixture.date,
        home: primaryFixture.home.name,
        away: primaryFixture.away.name,
        competition: primaryFixture.competition,
      });

      const fixtureMatch = matchCrossProviderFixture(primaryFixture, fallbackHistory);
      if (fixtureMatch.status !== "matched") {
        console.warn("[sports-fallback] fixture matching failed", {
          primaryFixtureId: primaryFixture.id,
          status: fixtureMatch.status,
          candidateIds: fixtureMatch.candidateIds,
        });
        return;
      }

      console.info("[sports-fallback] fixture matching succeeded", {
        primaryFixtureId: primaryFixture.id,
        fallbackFixtureId: fixtureMatch.fixture.id,
        fallbackProvider: this.fallback?.name ?? null,
      });

      const fallbackAttempt = await this.getMetricAttempt(
        this.fallback!,
        fixtureMatch.fixture,
        fallbackTeam.id,
        metric,
      );
      if (fallbackAttempt.match) {
        reconciled[index] = fallbackAttempt;
      }
    });

    const unresolved = missingIndexes.filter((index) => reconciled[index].match === null);
    if (unresolved.length > 0) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `A estatística "${metric}" continua ausente em ${unresolved.length} das ${selection.fixtures.length} partidas selecionadas (fixtures primárias: ${unresolved.map((index) => selection.fixtures[index].id).join(", ")}). O fallback só tentou reconciliar as mesmas partidas; nenhuma partida anterior foi usada como substituta e nenhum valor foi estimado.`,
      );
    }

    return reconciled.map((attempt) => attempt.match as MatchRecord);
  }
}
