import type { MatchRecord } from "@/data/sports";
import type { AggregateAnalysisResult, AnalysisStatistics, QueryIntent } from "@/lib/analysis";
import type { AnalysisOverrides } from "@/lib/analysis-request";
import type {
  AnalysisFixtureSummary,
  AnalysisProvenance,
  MatchListAnalysisResult,
  UniversalAnalysisIntent,
} from "@/lib/universal-analysis";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import { competitionNamesEquivalent } from "@/server/sports/competition-matcher";
import { getFootballMetricDefinition, type FootballMetric } from "@/server/sports/metric-catalog";
import type { ProviderFixture, ResolvedTeam } from "@/server/sports/provider";
import {
  resolveTeamMetricExecution,
  type TeamMetricExecutionPlan,
} from "@/server/sports/team-query-capability";
import { createUniversalFootballSources } from "@/server/sports/universal-provider.server";
import type { ProviderReadMeta, UniversalFootballSource } from "@/server/sports/universal-football";

import { aggregateNumericValues, aggregateRatio } from "./aggregation";
import { AnalysisPipelineError } from "./errors";
import {
  MAX_QUERY_MATCHES,
  queryPlanSchema,
  queryPlanSignature,
  type FootballAggregation,
  type QueryFilter,
  type FootballGroupByField,
  type QueryPlan,
  type QueryScope,
  queryScopeSchema,
} from "./query-plan";

const DATA_CONCURRENCY = 4;
const EUROPEAN_SEASON_COMPETITIONS = [
  "Premier League",
  "La Liga",
  "Bundesliga",
  "UEFA Champions League",
  "Serie A",
  "Ligue 1",
] as const;

interface ScoreRow {
  fixture: ProviderFixture;
  goalsFor: number | null;
  goalsAgainst: number | null;
  goalDifference: number | null;
  outcome: "win" | "draw" | "loss" | null;
  points: number | null;
  cleanSheet: boolean | null;
  failedToScore: boolean | null;
  bothTeamsScored: boolean | null;
  venue: "home" | "away";
  opponent: string;
}

export interface GroupedAggregateRow {
  key: string;
  dimensions: Partial<Record<FootballGroupByField, string>>;
  value: number;
  sample_size: number;
}

export type Phase4cTeamAggregateResult = AggregateAnalysisResult & {
  result_type: "aggregate";
  result_version: 3;
  result_kind: "aggregate" | "grouped_aggregate";
  query_plan: QueryPlan;
  groups: GroupedAggregateRow[];
  provenance: AnalysisProvenance;
};

export type Phase4cTeamResult = Phase4cTeamAggregateResult | MatchListAnalysisResult;

function canTryNextSource(error: unknown): boolean {
  return (
    error instanceof AnalysisPipelineError &&
    ["TEAM_NOT_FOUND", "PROVIDER_UNAVAILABLE", "API_LIMIT_REACHED", "DATA_INSUFFICIENT"].includes(
      error.code,
    )
  );
}

async function firstSuccessful<T>(
  sources: readonly UniversalFootballSource[],
  worker: (source: UniversalFootballSource) => Promise<T>,
): Promise<T> {
  if (sources.length === 0) {
    throw new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "Nenhum provider universal de futebol está configurado no servidor.",
    );
  }

  let lastError: unknown = null;
  for (const source of sources) {
    try {
      return await worker(source);
    } catch (error) {
      if (!canTryNextSource(error)) throw error;
      lastError = error;
      console.warn("[phase4c-query] capability-aware fallback", {
        provider: source.name,
        reason: error instanceof AnalysisPipelineError ? error.code : "unknown",
      });
    }
  }

  if (lastError instanceof AnalysisPipelineError) throw lastError;
  throw new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    "Os providers configurados não conseguiram executar a consulta universal.",
  );
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function run() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(Math.max(1, limit), items.length) }, () => run()),
  );
  return results;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalCompetitionOverride(value: string): string {
  const normalized = normalizeText(value);
  if (
    ["brasileirao", "brasileirao serie a", "campeonato brasileiro serie a"].includes(normalized)
  ) {
    return "Brasileirão Série A";
  }
  if (["premier", "premier league"].includes(normalized)) return "Premier League";
  if (["laliga", "la liga", "primera division"].includes(normalized)) return "La Liga";
  if (["champions", "champions league", "ucl", "uefa champions league"].includes(normalized)) {
    return "UEFA Champions League";
  }
  if (["bundesliga", "bundesliga alema"].includes(normalized)) return "Bundesliga";
  return value;
}

function applyOverrides(plan: QueryPlan, overrides?: AnalysisOverrides): QueryPlan {
  if (!overrides) return plan;
  const scope = {
    ...plan.scope,
    ...(overrides.match_count !== undefined ? { last_matches: overrides.match_count } : {}),
    ...(overrides.venue !== undefined ? { venue: overrides.venue } : {}),
    ...(Object.prototype.hasOwnProperty.call(overrides, "competition")
      ? overrides.competition
        ? { competition: canonicalCompetitionOverride(overrides.competition) }
        : { competition: undefined }
      : {}),
  };
  return queryPlanSchema.parse({ ...plan, scope });
}

function isEuropeanSeasonCompetition(competition: string | undefined): boolean {
  if (!competition) return false;
  return EUROPEAN_SEASON_COMPETITIONS.some((candidate) =>
    competitionNamesEquivalent(candidate, competition),
  );
}

function seasonWindow(
  season: string,
  competition: string | undefined,
  now = new Date(),
): { date_from: string; date_to: string } | null {
  const value = season.trim().toLowerCase();
  const european = isEuropeanSeasonCompetition(competition);
  const currentYear = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;

  if (value === "current") {
    if (european) {
      const start = month >= 7 ? currentYear : currentYear - 1;
      return { date_from: `${start}-07-01`, date_to: `${start + 1}-06-30` };
    }
    return { date_from: `${currentYear}-01-01`, date_to: `${currentYear}-12-31` };
  }

  if (value === "previous") {
    if (european) {
      const currentStart = month >= 7 ? currentYear : currentYear - 1;
      const start = currentStart - 1;
      return { date_from: `${start}-07-01`, date_to: `${start + 1}-06-30` };
    }
    const year = currentYear - 1;
    return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
  }

  const calendar = value.match(/^(\d{4})$/);
  if (calendar) {
    const year = Number(calendar[1]);
    return { date_from: `${year}-01-01`, date_to: `${year}-12-31` };
  }

  const split = value.match(/^(\d{4})\s*[/-]\s*(\d{2}|\d{4})$/);
  if (split) {
    const start = Number(split[1]);
    const end =
      split[2].length === 2 ? Math.floor(start / 100) * 100 + Number(split[2]) : Number(split[2]);
    if (end === start + 1) {
      return { date_from: `${start}-07-01`, date_to: `${end}-06-30` };
    }
  }

  return null;
}

function executionScope(plan: QueryPlan): QueryScope {
  const status = plan.scope.status ?? "finished";
  const window = plan.scope.season ? seasonWindow(plan.scope.season, plan.scope.competition) : null;
  if (plan.scope.season && !window) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      `A temporada "${plan.scope.season}" foi compreendida, mas não pôde ser normalizada para um intervalo real de datas.`,
    );
  }

  return queryScopeSchema.parse({
    ...plan.scope,
    status,
    ...(window && !plan.scope.date_from ? { date_from: window.date_from } : {}),
    ...(window && !plan.scope.date_to ? { date_to: window.date_to } : {}),
    // Opponent is resolved to a real provider entity and filtered by ID below.
    opponent: undefined,
  });
}

function scoreRow(fixture: ProviderFixture, team: ResolvedTeam): ScoreRow {
  const isHome = fixture.home.id === team.id;
  const goalsFor = isHome ? fixture.goals.home : fixture.goals.away;
  const goalsAgainst = isHome ? fixture.goals.away : fixture.goals.home;
  const completeScore = goalsFor !== null && goalsAgainst !== null;
  const outcome = !completeScore
    ? null
    : goalsFor > goalsAgainst
      ? ("win" as const)
      : goalsFor < goalsAgainst
        ? ("loss" as const)
        : ("draw" as const);
  return {
    fixture,
    goalsFor,
    goalsAgainst,
    goalDifference: completeScore ? goalsFor - goalsAgainst : null,
    outcome,
    points: outcome === null ? null : outcome === "win" ? 3 : outcome === "draw" ? 1 : 0,
    cleanSheet: completeScore ? goalsAgainst === 0 : null,
    failedToScore: completeScore ? goalsFor === 0 : null,
    bothTeamsScored: completeScore ? goalsFor > 0 && goalsAgainst > 0 : null,
    venue: isHome ? "home" : "away",
    opponent: isHome ? fixture.away.name : fixture.home.name,
  };
}

function fixtureInsideScope(
  row: ScoreRow,
  scope: QueryScope,
  opponent: ResolvedTeam | null,
): boolean {
  if (scope.status && scope.status !== "finished") return false;
  if (scope.venue !== "all" && row.venue !== scope.venue) return false;
  if (
    scope.competition &&
    !competitionNamesEquivalent(scope.competition, row.fixture.competition)
  ) {
    return false;
  }
  if (opponent) {
    const other = row.venue === "home" ? row.fixture.away : row.fixture.home;
    if (other.id !== opponent.id) return false;
  }
  const day = new Date(row.fixture.timestamp * 1000).toISOString().slice(0, 10);
  if (scope.date_from && day < scope.date_from) return false;
  if (scope.date_to && day > scope.date_to) return false;
  return true;
}

function filterFieldValue(
  row: ScoreRow,
  field: QueryFilter["field"],
): string | number | boolean | null {
  if (field === "outcome") return row.outcome;
  if (field === "goals_for") return row.goalsFor;
  if (field === "goals_against") return row.goalsAgainst;
  if (field === "goal_difference") return row.goalDifference;
  if (field === "points") return row.points;
  if (field === "clean_sheet") return row.cleanSheet;
  if (field === "failed_to_score") return row.failedToScore;
  if (field === "both_teams_scored") return row.bothTeamsScored;
  if (field === "venue") return row.venue;
  if (field === "competition") return row.fixture.competition;
  return row.opponent;
}

function scalarEquals(left: string | number | boolean, right: string | number | boolean): boolean {
  if (typeof left === "string" && typeof right === "string") {
    if (competitionNamesEquivalent(left, right)) return true;
    return normalizeText(left) === normalizeText(right);
  }
  return left === right;
}

function matchesFilter(row: ScoreRow, filter: QueryFilter): boolean {
  const left = filterFieldValue(row, filter.field);
  if (left === null) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A partida ${row.fixture.id} não possui o valor necessário para aplicar o filtro ${filter.field}. Null não foi tratado como zero.`,
    );
  }

  if (filter.operator === "in") {
    const values = Array.isArray(filter.value) ? filter.value : [filter.value];
    return values.some((value) => scalarEquals(left, value));
  }

  const right = Array.isArray(filter.value) ? filter.value[0] : filter.value;
  if (filter.operator === "eq") return scalarEquals(left, right);
  if (filter.operator === "neq") return !scalarEquals(left, right);
  if (typeof left !== "number" || typeof right !== "number") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      `O operador ${filter.operator} exige valores numéricos em ${filter.field}.`,
    );
  }
  if (filter.operator === "gt") return left > right;
  if (filter.operator === "gte") return left >= right;
  if (filter.operator === "lt") return left < right;
  return left <= right;
}

function applyFilters(rows: readonly ScoreRow[], filters: readonly QueryFilter[]): ScoreRow[] {
  if (filters.length === 0) return [...rows];
  return rows.filter((row) => filters.every((filter) => matchesFilter(row, filter)));
}

function selectScopeRows(
  rows: readonly ScoreRow[],
  scope: QueryScope,
  requestedLastMatches: number | undefined,
): ScoreRow[] {
  const ordered = [...rows].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  if (!requestedLastMatches) {
    // Whole explicit scope means the whole scope. With no explicit bounded scope, keep a
    // configurable technical history cap instead of silently choosing five matches.
    const bounded = Boolean(scope.date_from || scope.date_to || scope.season || scope.competition);
    return bounded ? ordered : ordered.slice(-MAX_QUERY_MATCHES);
  }

  const selected = ordered.slice(-requestedLastMatches);
  if (selected.length < requestedLastMatches) {
    const finiteScope = Boolean(scope.season || scope.date_from || scope.date_to);
    if (!finiteScope) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `Foram encontradas ${selected.length} de ${requestedLastMatches} partidas dentro do escopo solicitado. Nenhuma competição ou temporada diferente foi usada para completar a amostra.`,
      );
    }
  }
  return selected;
}

function metricValue(row: ScoreRow, metric: FootballMetric): number | null {
  if (metric === "goals_for") return row.goalsFor;
  if (metric === "goals_against") return row.goalsAgainst;
  if (metric === "goal_difference") return row.goalDifference;
  if (metric === "wins") return row.outcome === null ? null : row.outcome === "win" ? 1 : 0;
  if (metric === "draws") return row.outcome === null ? null : row.outcome === "draw" ? 1 : 0;
  if (metric === "losses") return row.outcome === null ? null : row.outcome === "loss" ? 1 : 0;
  if (metric === "points") return row.points;
  if (metric === "win_rate") return row.outcome === null ? null : row.outcome === "win" ? 1 : 0;
  if (metric === "unbeaten_rate")
    return row.outcome === null ? null : row.outcome !== "loss" ? 1 : 0;
  if (metric === "clean_sheets") return row.cleanSheet === null ? null : row.cleanSheet ? 1 : 0;
  if (metric === "failed_to_score")
    return row.failedToScore === null ? null : row.failedToScore ? 1 : 0;
  if (metric === "both_teams_scored") {
    return row.bothTeamsScored === null ? null : row.bothTeamsScored ? 1 : 0;
  }
  return null;
}

const INDICATOR_METRICS = new Set<FootballMetric>([
  "wins",
  "draws",
  "losses",
  "clean_sheets",
  "failed_to_score",
  "both_teams_scored",
  "win_rate",
  "unbeaten_rate",
]);

function aggregateMetric(
  metric: FootballMetric,
  aggregation: FootballAggregation,
  values: readonly (number | null)[],
): { value: number | null; known: number; missing: number } {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const missing = values.length - known.length;
  if (values.length === 0 || missing > 0) return { value: null, known: known.length, missing };

  if (INDICATOR_METRICS.has(metric)) {
    const numerator = known.reduce((sum, value) => sum + value, 0);
    if (aggregation === "percentage" || aggregation === "rate") {
      const ratio = aggregateRatio(numerator, values.length, aggregation);
      return { value: ratio.value, known: known.length, missing };
    }
    if (aggregation === "count" || aggregation === "total") {
      return { value: numerator, known: known.length, missing };
    }
  }

  if (metric === "points" && (aggregation === "percentage" || aggregation === "rate")) {
    const points = known.reduce((sum, value) => sum + value, 0);
    return {
      value: aggregateRatio(points, values.length * 3, aggregation).value,
      known: known.length,
      missing,
    };
  }

  if (aggregation === "percentage" || aggregation === "rate") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `${aggregation} exige um denominador semântico explícito; a métrica ${metric} não define um denominador nessa execução.`,
    );
  }

  const result = aggregateNumericValues(values, aggregation);
  return { value: result.value, known: result.coverage.known, missing: result.coverage.missing };
}

function groupDimensions(
  row: ScoreRow,
  fields: readonly FootballGroupByField[],
  scope: QueryScope,
) {
  const dimensions: Partial<Record<FootballGroupByField, string>> = {};
  for (const field of fields) {
    if (field === "venue") dimensions[field] = row.venue === "home" ? "Casa" : "Fora";
    else if (field === "competition") dimensions[field] = row.fixture.competition;
    else if (field === "opponent") dimensions[field] = row.opponent;
    else if (field === "outcome") {
      dimensions[field] =
        row.outcome === "win" ? "Vitória" : row.outcome === "draw" ? "Empate" : "Derrota";
    } else if (field === "month") dimensions[field] = row.fixture.date.slice(0, 7);
    else if (field === "year") dimensions[field] = row.fixture.date.slice(0, 4);
    else if (field === "season") dimensions[field] = scope.season ?? row.fixture.date.slice(0, 4);
  }
  return dimensions;
}

function groupKey(
  dimensions: Partial<Record<FootballGroupByField, string>>,
  fields: readonly FootballGroupByField[],
) {
  return fields.map((field) => `${field}:${dimensions[field] ?? "-"}`).join("|");
}

function formatGroupLabel(
  dimensions: Partial<Record<FootballGroupByField, string>>,
  fields: readonly FootballGroupByField[],
) {
  return fields.map((field) => dimensions[field] ?? "-").join(" · ");
}

function fixtureSummary(row: ScoreRow, source: UniversalFootballSource): AnalysisFixtureSummary {
  return {
    fixture_id: String(row.fixture.id),
    date: row.fixture.date,
    status: row.fixture.status,
    competition: row.fixture.competition,
    home_team: { id: String(row.fixture.home.id), name: row.fixture.home.name },
    away_team: { id: String(row.fixture.away.id), name: row.fixture.away.name },
    home_goals: row.fixture.goals.home,
    away_goals: row.fixture.goals.away,
    opponent: row.opponent,
    venue: row.venue,
    result: `${row.fixture.goals.home ?? "-"}-${row.fixture.goals.away ?? "-"}`,
    outcome:
      row.outcome === "win"
        ? "V"
        : row.outcome === "draw"
          ? "E"
          : row.outcome === "loss"
            ? "D"
            : null,
    source: source.name,
  };
}

function matchRecord(row: ScoreRow, value: number, source: UniversalFootballSource): MatchRecord {
  return {
    id: String(row.fixture.id),
    date: row.fixture.date,
    opponent: row.opponent,
    competition: row.fixture.competition,
    venue: row.venue,
    result: `${row.fixture.goals.home ?? "-"}-${row.fixture.goals.away ?? "-"}`,
    outcome: row.outcome === "win" ? "V" : row.outcome === "draw" ? "E" : "D",
    value,
    source: source.name,
  };
}

function combineMeta(
  base: ProviderReadMeta,
  metricPlan: TeamMetricExecutionPlan,
): ProviderReadMeta {
  return {
    ...base,
    dataFamily:
      metricPlan.kind === "derived"
        ? `${base.dataFamily} + fixture_score`
        : `${base.dataFamily} + fixture_stats`,
    endpoint:
      metricPlan.kind === "derived" ? base.endpoint : `${base.endpoint} + fixture statistics`,
  };
}

async function resolveRows(params: { source: UniversalFootballSource; plan: QueryPlan }): Promise<{
  team: ResolvedTeam;
  rows: ScoreRow[];
  meta: ProviderReadMeta;
  scope: QueryScope;
}> {
  const { source, plan } = params;
  const scope = executionScope(plan);
  const team = await source.resolveTeam(plan.entity.name);
  const opponent = plan.scope.opponent ? await source.resolveTeam(plan.scope.opponent) : null;
  if (opponent && opponent.id === team.id) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      "O adversário do escopo não pode ser a própria entidade principal.",
    );
  }

  const read = await source.listTeamFixtures(team, scope);
  const scoped = read.fixtures
    .map((fixture) => scoreRow(fixture, team))
    .filter((row) => fixtureInsideScope(row, scope, opponent));
  const selected = selectScopeRows(
    scoped,
    { ...scope, season: plan.scope.season },
    plan.scope.last_matches,
  );

  if (selected.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida concluída foi encontrada para o escopo solicitado. Nenhum jogo fora do escopo foi usado.",
    );
  }

  return { team, rows: selected, meta: read.meta, scope: { ...scope, season: plan.scope.season } };
}

async function metricValuesForRows(params: {
  source: UniversalFootballSource;
  team: ResolvedTeam;
  rows: readonly ScoreRow[];
  metric: FootballMetric;
  execution: TeamMetricExecutionPlan;
}): Promise<(number | null)[]> {
  if (params.execution.kind === "unsupported") {
    throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", params.execution.reason);
  }
  if (params.execution.kind === "derived") {
    return params.rows.map((row) => metricValue(row, params.metric));
  }
  const rawMetric = params.execution.rawMetric;
  return mapWithConcurrency(params.rows, DATA_CONCURRENCY, (row) =>
    params.source.getFixtureMetric(row.fixture, params.team.id, rawMetric),
  );
}

function buildStatistics(values: readonly number[]): AnalysisStatistics {
  const total = values.reduce((sum, value) => sum + value, 0);
  const average = values.length ? total / values.length : 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const median = values.length
    ? ordered.length % 2 === 1
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2
    : 0;
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    average: round(average),
    median: round(median),
    total: round(total),
    maximum: values.length ? Math.max(...values) : 0,
    minimum: values.length ? Math.min(...values) : 0,
    sample_size: values.length,
    trend: 0,
  };
}

function metricUnit(metric: FootballMetric, aggregation: FootballAggregation): string {
  if (aggregation === "percentage") return "%";
  if (aggregation === "rate") return "taxa";
  const definition = getFootballMetricDefinition(metric, "team");
  if (!definition) return "valor";
  if (definition.unit === "percentage") return "%";
  if (definition.unit === "goals") return "gols";
  return definition.unit === "count" ? "" : definition.unit;
}

function groupRows(params: {
  rows: readonly ScoreRow[];
  values: readonly (number | null)[];
  fields: readonly FootballGroupByField[];
  scope: QueryScope;
  metric: FootballMetric;
  aggregation: FootballAggregation;
  sort: QueryPlan["sort"];
  limit: number | undefined;
}): GroupedAggregateRow[] {
  if (params.fields.length === 0) return [];
  const grouped = new Map<
    string,
    { dimensions: Partial<Record<FootballGroupByField, string>>; values: (number | null)[] }
  >();
  params.rows.forEach((row, index) => {
    const dimensions = groupDimensions(row, params.fields, params.scope);
    const key = groupKey(dimensions, params.fields);
    const current = grouped.get(key) ?? { dimensions, values: [] };
    current.values.push(params.values[index]);
    grouped.set(key, current);
  });

  const result = [...grouped.values()].map((entry) => {
    const aggregate = aggregateMetric(params.metric, params.aggregation, entry.values);
    if (aggregate.value === null) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${aggregate.known} de ${entry.values.length} partidas possuem a métrica ${params.metric} no grupo ${formatGroupLabel(entry.dimensions, params.fields)}. A agregação não foi estimada.`,
      );
    }
    return {
      key: groupKey(entry.dimensions, params.fields),
      dimensions: entry.dimensions,
      value: aggregate.value,
      sample_size: entry.values.length,
    };
  });

  if (params.sort) {
    const direction = params.sort.direction === "asc" ? 1 : -1;
    result.sort((left, right) => {
      if (params.sort?.field === "sample_size")
        return (left.sample_size - right.sample_size) * direction;
      if (params.sort?.field === "group") return left.key.localeCompare(right.key) * direction;
      return (left.value - right.value) * direction;
    });
  } else if (params.fields.length === 1 && params.fields[0] === "venue") {
    result.sort((left, right) => {
      const order = (item: GroupedAggregateRow) => (item.dimensions.venue === "Casa" ? 0 : 1);
      return order(left) - order(right);
    });
  } else {
    result.sort((left, right) => left.key.localeCompare(right.key));
  }

  return params.limit ? result.slice(0, params.limit) : result;
}

async function analyzeAggregate(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<Phase4cTeamAggregateResult> {
  const { question, plan, source } = params;
  if (!plan.metric || !plan.aggregation) {
    throw new AnalysisPipelineError(
      "QUESTION_NOT_UNDERSTOOD",
      "Aggregate exige métrica e agregação.",
    );
  }
  if (plan.scope.half !== "full") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      "As métricas de placar desta fase usam placar final. Primeiro/segundo tempo exige a família de dados por período.",
    );
  }
  if (plan.scope.status && plan.scope.status !== "finished") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      "Aggregate universal desta fase calcula apenas partidas concluídas.",
    );
  }

  const execution = resolveTeamMetricExecution(plan.metric);
  if (execution.kind === "unsupported") {
    throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", execution.reason);
  }

  const resolved = await resolveRows({ source, plan });
  const filtered = applyFilters(resolved.rows, plan.filters);
  if (filtered.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida do escopo satisfez os filtros estruturados solicitados.",
    );
  }

  const values = await metricValuesForRows({
    source,
    team: resolved.team,
    rows: filtered,
    metric: plan.metric,
    execution,
  });
  const aggregate = aggregateMetric(plan.metric, plan.aggregation, values);
  if (aggregate.value === null) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${aggregate.known} de ${filtered.length} partidas possuem a métrica ${plan.metric}. Esta fase exige cobertura completa da amostra e não converte null em zero.`,
    );
  }

  const groups = groupRows({
    rows: filtered,
    values,
    fields: plan.group_by,
    scope: resolved.scope,
    metric: plan.metric,
    aggregation: plan.aggregation,
    sort: plan.sort,
    limit: plan.limit,
  });
  const knownValues = values.filter((value): value is number => value !== null);
  const definition = getFootballMetricDefinition(plan.metric, "team");
  const label = definition?.label ?? plan.metric;
  const unit = metricUnit(plan.metric, plan.aggregation);
  const scopeParts = [
    plan.scope.competition ?? null,
    plan.scope.season ? `temporada ${plan.scope.season}` : null,
    plan.scope.venue === "home" ? "em casa" : plan.scope.venue === "away" ? "fora" : null,
  ].filter(Boolean);
  const groupSummary = groups.length
    ? ` ${groups.map((group) => `${formatGroupLabel(group.dimensions, plan.group_by)}: ${group.value}`).join(" · ")}.`
    : "";
  const summary = `${label}: ${aggregate.value}${unit ? ` ${unit}` : ""} em ${filtered.length} partida${filtered.length === 1 ? "" : "s"}${scopeParts.length ? ` (${scopeParts.join(" · ")})` : ""}.${groupSummary}`;

  const intent: QueryIntent = {
    sport: "football",
    query_kind: "aggregate",
    entity_type: "team",
    entity_name: resolved.team.name,
    entity_id: String(resolved.team.id),
    compare_with: null,
    metric: plan.metric,
    metric_label: label,
    // QueryIntent is the persisted legacy envelope; the exact universal aggregation is
    // preserved in query_plan and answer. Runtime consumers do not recalculate from this field.
    aggregation: plan.aggregation as QueryIntent["aggregation"],
    match_count: filtered.length,
    competition: plan.scope.competition ?? null,
    venue: plan.scope.venue,
  };
  const meta = combineMeta(resolved.meta, execution);
  const provenance: AnalysisProvenance = {
    provider: source.name,
    source_endpoint: meta.endpoint,
    data_family: meta.dataFamily,
    fetched_at: meta.fetchedAt,
    cache_status: meta.cacheStatus,
    sample_size: filtered.length,
    missing_values: aggregate.missing,
    resolved_entity_ids: [String(resolved.team.id)],
    competition: plan.scope.competition ?? null,
    season: plan.scope.season ?? null,
  };
  const cacheKey = `v4c|${source.name}|${resolved.team.id}|${queryPlanSignature(plan)}`;
  const matches = filtered.map((row, index) => matchRecord(row, knownValues[index], source));

  console.info("[phase4c-query] aggregate", {
    query_kind: plan.query_kind,
    metric: plan.metric,
    aggregation: plan.aggregation,
    entity_type: plan.entity.type,
    resolved_entity_id: resolved.team.id,
    scope: plan.scope,
    data_family: execution.dataFamily,
    provider: source.name,
    cache_status: meta.cacheStatus,
    sample_size: filtered.length,
  });

  return {
    result_type: "aggregate",
    result_version: 3,
    result_kind: groups.length ? "grouped_aggregate" : "aggregate",
    query_plan: plan,
    groups,
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question,
    created_at: new Date().toISOString(),
    intent,
    answer: {
      value: aggregate.value,
      unit,
      summary,
      explanation: `Cálculo determinístico sobre ${filtered.length} partidas. Dados ausentes permanecem null e tornam a amostra insuficiente; nenhuma estatística foi estimada.`,
    },
    statistics: buildStatistics(knownValues),
    chart_data: filtered.map((row, index) => ({
      label: new Date(row.fixture.date).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      }),
      value: knownValues[index],
      opponent: row.opponent,
      venue: row.venue === "home" ? "Casa" : "Fora",
    })),
    matches: [...matches].reverse(),
    insights: groups.length
      ? groups.map(
          (group) =>
            `${formatGroupLabel(group.dimensions, plan.group_by)}: ${group.value} (${group.sample_size} jogos).`,
        )
      : [`A amostra efetiva contém ${filtered.length} partidas após scope e filtros.`],
    related: [
      `Compare ${label.toLowerCase()} de ${resolved.team.name} em casa e fora`,
      `Mostre os jogos usados nesta análise do ${resolved.team.name}`,
    ],
    source: { provider: source.name, updated_at: meta.fetchedAt, missing: aggregate.missing },
    provenance,
    demo: false,
  };
}

async function analyzeMatchList(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<MatchListAnalysisResult> {
  const resolved = await resolveRows({ source: params.source, plan: params.plan });
  const filtered = applyFilters(resolved.rows, params.plan.filters);
  const limited = params.plan.limit ? filtered.slice(-params.plan.limit) : filtered;
  if (limited.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida do escopo satisfez os filtros da lista solicitada.",
    );
  }
  const summaries = limited.map((row) => fixtureSummary(row, params.source));
  const intent: UniversalAnalysisIntent = {
    sport: "football",
    query_kind: "match_list",
    entity_type: "team",
    entity_name: resolved.team.name,
    entity_id: String(resolved.team.id),
    compare_with: null,
    metric: params.plan.metric ?? null,
    aggregation: params.plan.aggregation ?? null,
    match_count: limited.length,
    competition: params.plan.scope.competition ?? null,
    venue: params.plan.scope.venue,
    status: "finished",
  };
  const provenance: AnalysisProvenance = {
    provider: params.source.name,
    source_endpoint: resolved.meta.endpoint,
    data_family: resolved.meta.dataFamily,
    fetched_at: resolved.meta.fetchedAt,
    cache_status: resolved.meta.cacheStatus,
    sample_size: limited.length,
    missing_values: limited.filter((row) => row.goalsFor === null || row.goalsAgainst === null)
      .length,
    resolved_entity_ids: [String(resolved.team.id)],
    competition: params.plan.scope.competition ?? null,
    season: params.plan.scope.season ?? null,
  };
  const cacheKey = `v4c|${params.source.name}|${resolved.team.id}|${queryPlanSignature(params.plan)}`;
  return {
    result_type: "match_list",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: new Date().toISOString(),
    intent: intent as MatchListAnalysisResult["intent"],
    team: { id: String(resolved.team.id), name: resolved.team.name },
    matches: summaries,
    related: [
      `Qual foi a média de gols sofridos do ${resolved.team.name} nessa amostra?`,
      `Em quantos desses jogos o ${resolved.team.name} não sofreu gol?`,
    ],
    source: {
      provider: params.source.name,
      updated_at: resolved.meta.fetchedAt,
      missing: provenance.missing_values,
    },
    provenance,
    demo: false,
  };
}

export function isPhase4cUniversalTeamPlan(plan: QueryPlan): boolean {
  return plan.entity.type === "team" && ["aggregate", "match_list"].includes(plan.query_kind);
}

export async function analyzePhase4cUniversalTeamPlanWithSources(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
  sources: readonly UniversalFootballSource[];
}): Promise<Phase4cTeamResult> {
  const plan = applyOverrides(params.plan, params.overrides);
  if (!isPhase4cUniversalTeamPlan(plan)) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `A Phase 4C não executa ${plan.entity.type}/${plan.query_kind}.`,
    );
  }
  return firstSuccessful<Phase4cTeamResult>(params.sources, (source) =>
    plan.query_kind === "aggregate"
      ? analyzeAggregate({ question: params.question, plan, source })
      : analyzeMatchList({ question: params.question, plan, source }),
  );
}

export async function analyzePhase4cUniversalTeamPlan(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
}): Promise<Phase4cTeamResult> {
  return analyzePhase4cUniversalTeamPlanWithSources({
    ...params,
    sources: createUniversalFootballSources(params.observer),
  });
}
