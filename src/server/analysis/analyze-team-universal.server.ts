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
import type { CompetitionSeason } from "@/server/sports/competition-season-registry";
import { fixtureStatValue, type NormalizedTeamFixtureStats } from "@/server/sports/fixture-stats";
import {
  getFootballMetricDefinition,
  TEAM_METRIC_KEYS,
  type FootballMetric,
  type TeamMetric,
} from "@/server/sports/metric-catalog";
import type { ProviderFixture, ResolvedTeam } from "@/server/sports/provider";
import {
  resolveTeamMetricExecution,
  type TeamMetricExecutionPlan,
} from "@/server/sports/team-query-capability";
import { createUniversalFootballSources } from "@/server/sports/universal-provider.server";
import type {
  ProviderFixtureScope,
  ProviderReadMeta,
  UniversalFootballSource,
  UniversalProviderName,
} from "@/server/sports/universal-football";

import { aggregateNumericValues, aggregateRatio } from "./aggregation";
import { AnalysisPipelineError } from "./errors";
import {
  MAX_QUERY_MATCHES,
  queryPlanSchema,
  queryPlanSignature,
  queryScopeSchema,
  type FootballAggregation,
  type FootballGroupByField,
  type QueryFilter,
  type QueryPlan,
  type QueryScope,
} from "./query-plan";

const DATA_CONCURRENCY = 4;
const TEAM_METRIC_SET = new Set<string>(TEAM_METRIC_KEYS);

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

interface ResolvedRows {
  team: ResolvedTeam;
  rows: ScoreRow[];
  fixtureMeta: ProviderReadMeta;
  seasonMeta: ProviderReadMeta | null;
  scope: QueryScope;
  resolvedSeason: CompetitionSeason | null;
}

interface SnapshotContext {
  snapshots: Map<number, NormalizedTeamFixtureStats>;
  metas: ProviderReadMeta[];
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

async function firstSuccessful<T extends Phase4cTeamResult>(
  sources: readonly UniversalFootballSource[],
  worker: (source: UniversalFootballSource) => Promise<T>,
): Promise<T> {
  if (sources.length === 0) {
    throw new AnalysisPipelineError(
      "PROVIDER_UNAVAILABLE",
      "Nenhum provider universal de futebol está configurado no servidor.",
    );
  }

  const attempted: string[] = [];
  let lastError: unknown = null;
  for (const source of sources) {
    attempted.push(source.name);
    try {
      const result = await worker(source);
      result.provenance.providers_attempted = [...attempted];
      result.provenance.fallback_occurred = attempted.length > 1;
      return result;
    } catch (error) {
      if (!canTryNextSource(error)) throw error;
      lastError = error;
      console.warn("[phase5b-query] conservative fallback", {
        provider: source.name,
        reason: error instanceof AnalysisPipelineError ? error.code : "unknown",
      });
    }
  }
  if (lastError instanceof AnalysisPipelineError) throw lastError;
  throw new AnalysisPipelineError(
    "PROVIDER_UNAVAILABLE",
    "Os providers configurados não conseguiram executar integralmente a consulta.",
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

function baseExecutionScope(plan: QueryPlan): QueryScope {
  return queryScopeSchema.parse({
    ...plan.scope,
    status: plan.scope.status ?? "finished",
    // Opponent is resolved to an ID and applied locally. Season stays symbolic until the provider
    // returns a real CompetitionSeason; no calendar heuristic is derived from the label.
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
  resolvedSeason: CompetitionSeason | null,
): boolean {
  if (scope.status && scope.status !== "finished") return false;
  if (scope.venue !== "all" && row.venue !== scope.venue) return false;
  if (
    scope.competition &&
    !competitionNamesEquivalent(scope.competition, row.fixture.competition)
  ) {
    return false;
  }
  if (resolvedSeason) {
    if (row.fixture.competitionId && row.fixture.competitionId !== resolvedSeason.competitionId) {
      return false;
    }
    if (row.fixture.seasonId && row.fixture.seasonId !== resolvedSeason.seasonId) return false;
    const day = new Date(row.fixture.timestamp * 1000).toISOString().slice(0, 10);
    if (day < resolvedSeason.startDate.slice(0, 10) || day > resolvedSeason.endDate.slice(0, 10)) {
      return false;
    }
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

function scoreMetricValue(row: ScoreRow, metric: FootballMetric): number | null {
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

function structuralFilterValue(
  row: ScoreRow,
  field: QueryFilter["field"],
): string | number | boolean | null | undefined {
  if (field === "outcome") return row.outcome;
  if (field === "venue") return row.venue;
  if (field === "competition") return row.fixture.competition;
  if (field === "opponent") return row.opponent;
  if (field === "clean_sheet") return row.cleanSheet;
  if (TEAM_METRIC_SET.has(field)) {
    const execution = resolveTeamMetricExecution(field as TeamMetric);
    if (execution.kind === "derived") return scoreMetricValue(row, field as TeamMetric);
  }
  return undefined;
}

function scalarEquals(left: string | number | boolean, right: string | number | boolean): boolean {
  if (typeof left === "string" && typeof right === "string") {
    if (competitionNamesEquivalent(left, right)) return true;
    return normalizeText(left) === normalizeText(right);
  }
  return left === right;
}

function compareFilterValue(
  left: string | number | boolean | null,
  filter: QueryFilter,
  fixtureId: number,
): boolean {
  if (left === null) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A partida ${fixtureId} não possui o valor necessário para aplicar ${filter.field}. UNKNOWN não foi convertido em zero.`,
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

function splitFilters(filters: readonly QueryFilter[]): {
  structural: QueryFilter[];
  statistics: QueryFilter[];
} {
  const structural: QueryFilter[] = [];
  const statistics: QueryFilter[] = [];
  for (const filter of filters) {
    const structuralField =
      ["outcome", "venue", "competition", "opponent", "clean_sheet"].includes(filter.field) ||
      (TEAM_METRIC_SET.has(filter.field) &&
        resolveTeamMetricExecution(filter.field as TeamMetric).kind === "derived");
    (structuralField ? structural : statistics).push(filter);
  }
  return { structural, statistics };
}

function applyStructuralFilters(
  rows: readonly ScoreRow[],
  filters: readonly QueryFilter[],
): ScoreRow[] {
  if (filters.length === 0) return [...rows];
  return rows.filter((row) =>
    filters.every((filter) => {
      const value = structuralFilterValue(row, filter.field);
      if (value === undefined) {
        throw new AnalysisPipelineError(
          "UNSUPPORTED_FILTER",
          `O filtro ${filter.field} não é estrutural e não pode ser aplicado sem fixture_stats.`,
        );
      }
      return compareFilterValue(value, filter, row.fixture.id);
    }),
  );
}

function selectScopeRows(
  rows: readonly ScoreRow[],
  scope: QueryScope,
  requestedLastMatches: number | undefined,
): ScoreRow[] {
  const ordered = [...rows].sort((a, b) => a.fixture.timestamp - b.fixture.timestamp);
  if (!requestedLastMatches) {
    const bounded = Boolean(scope.date_from || scope.date_to || scope.season || scope.competition);
    return bounded ? ordered.slice(-MAX_QUERY_MATCHES) : ordered.slice(-MAX_QUERY_MATCHES);
  }
  const selected = ordered.slice(-requestedLastMatches);
  if (selected.length < requestedLastMatches) {
    const finiteScope = Boolean(scope.season || scope.date_from || scope.date_to);
    if (!finiteScope) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `Foram encontradas ${selected.length} de ${requestedLastMatches} partidas no escopo. Nenhum jogo de outro escopo foi usado para completar a amostra.`,
      );
    }
  }
  return selected;
}

async function resolveRows(params: {
  source: UniversalFootballSource;
  plan: QueryPlan;
}): Promise<ResolvedRows> {
  const { source, plan } = params;
  const scope = baseExecutionScope(plan);
  const team = await source.resolveTeam(plan.entity.name);
  const opponent = plan.scope.opponent ? await source.resolveTeam(plan.scope.opponent) : null;
  if (opponent && opponent.id === team.id) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      "O adversário do escopo não pode ser a própria entidade principal.",
    );
  }

  let resolvedSeason: CompetitionSeason | null = null;
  let seasonMeta: ProviderReadMeta | null = null;
  const providerScope: ProviderFixtureScope = { ...scope };
  if (plan.scope.season) {
    if (!plan.scope.competition) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_FILTER",
        "Uma temporada explícita exige competição explícita para resolução provider-backed.",
      );
    }
    if (!source.resolveCompetitionSeason) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${source.name} não expõe resolução provider-backed de temporadas.`,
      );
    }
    const seasonRead = await source.resolveCompetitionSeason(
      plan.scope.competition,
      plan.scope.season,
    );
    resolvedSeason = seasonRead.season;
    seasonMeta = seasonRead.meta;
    providerScope.providerCompetitionId = resolvedSeason.competitionId;
    providerScope.providerSeasonId = resolvedSeason.seasonId;
    providerScope.date_from = plan.scope.date_from ?? resolvedSeason.startDate.slice(0, 10);
    providerScope.date_to = plan.scope.date_to ?? resolvedSeason.endDate.slice(0, 10);
  }

  const read = await source.listTeamFixtures(team, providerScope);
  const scoped = read.fixtures
    .map((fixture) => scoreRow(fixture, team))
    .filter((row) => fixtureInsideScope(row, scope, opponent, resolvedSeason));
  const selected = selectScopeRows(scoped, scope, plan.scope.last_matches);
  if (selected.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida concluída foi encontrada para o escopo solicitado. Nenhum jogo fora do escopo foi usado.",
    );
  }
  return { team, rows: selected, fixtureMeta: read.meta, seasonMeta, scope, resolvedSeason };
}

function rawMetricsNeeded(plan: QueryPlan): TeamMetric[] {
  const metrics = new Set<TeamMetric>();
  if (plan.metric && TEAM_METRIC_SET.has(plan.metric)) {
    const execution = resolveTeamMetricExecution(plan.metric);
    if (execution.kind === "raw") metrics.add(execution.rawMetric);
  }
  for (const filter of plan.filters) {
    if (!TEAM_METRIC_SET.has(filter.field)) continue;
    const execution = resolveTeamMetricExecution(filter.field as TeamMetric);
    if (execution.kind === "raw") metrics.add(execution.rawMetric);
  }
  return [...metrics];
}

async function snapshotsForRows(params: {
  source: UniversalFootballSource;
  team: ResolvedTeam;
  rows: readonly ScoreRow[];
  requiredMetrics: readonly TeamMetric[];
}): Promise<SnapshotContext> {
  if (params.requiredMetrics.length === 0) return { snapshots: new Map(), metas: [] };
  if (!params.source.getFixtureStats) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${params.source.name} não possui snapshot universal fixture_stats disponível.`,
    );
  }
  const reads = await mapWithConcurrency(params.rows, DATA_CONCURRENCY, (row) =>
    params.source.getFixtureStats!(row.fixture, params.team.id),
  );
  const snapshots = new Map<number, NormalizedTeamFixtureStats>();
  const metas: ProviderReadMeta[] = [];
  reads.forEach((read, index) => {
    const row = params.rows[index];
    for (const metric of params.requiredMetrics) {
      if (!read.snapshot.coverage.supported.includes(metric)) {
        throw new AnalysisPipelineError(
          "DATA_INSUFFICIENT",
          `${params.source.name} não suporta ${metric} no snapshot da partida ${row.fixture.id}.`,
        );
      }
    }
    snapshots.set(row.fixture.id, read.snapshot);
    metas.push(read.meta);
  });
  return { snapshots, metas };
}

function applyStatisticFilters(
  rows: readonly ScoreRow[],
  filters: readonly QueryFilter[],
  snapshots: ReadonlyMap<number, NormalizedTeamFixtureStats>,
): ScoreRow[] {
  if (filters.length === 0) return [...rows];
  return rows.filter((row) =>
    filters.every((filter) => {
      if (!TEAM_METRIC_SET.has(filter.field)) {
        throw new AnalysisPipelineError(
          "UNSUPPORTED_FILTER",
          `O filtro ${filter.field} não possui executor fixture_stats.`,
        );
      }
      const execution = resolveTeamMetricExecution(filter.field as TeamMetric);
      if (execution.kind !== "raw") {
        throw new AnalysisPipelineError(
          "UNSUPPORTED_FILTER",
          `O filtro ${filter.field} não possui executor fixture_stats raw.`,
        );
      }
      const value = fixtureStatValue(snapshots.get(row.fixture.id), execution.rawMetric);
      return compareFilterValue(value, filter, row.fixture.id);
    }),
  );
}

function metricValuesForRows(params: {
  rows: readonly ScoreRow[];
  metric: FootballMetric;
  execution: TeamMetricExecutionPlan;
  snapshots: ReadonlyMap<number, NormalizedTeamFixtureStats>;
}): (number | null)[] {
  if (params.execution.kind === "unsupported") {
    throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", params.execution.reason);
  }
  if (params.execution.kind === "derived") {
    return params.rows.map((row) => scoreMetricValue(row, params.metric));
  }
  const rawMetric = params.execution.rawMetric;
  return params.rows.map((row) =>
    fixtureStatValue(params.snapshots.get(row.fixture.id), rawMetric),
  );
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
  // Aggregations over fixture metrics are fail-closed: a partially unknown sample is not silently
  // reduced to the subset that happened to have data.
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
      value:
        aggregation === "percentage"
          ? (points / (values.length * 3)) * 100
          : points / (values.length * 3),
      known: known.length,
      missing,
    };
  }
  if (!["average", "median", "minimum", "maximum", "count", "total"].includes(aggregation)) {
    return { value: null, known: known.length, missing };
  }
  const result = aggregateNumericValues(
    known,
    aggregation as "average" | "median" | "minimum" | "maximum" | "count" | "total",
  );
  return { value: result.value, known: known.length, missing };
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

function metricUnit(metric: FootballMetric, aggregation: FootballAggregation | null): string {
  if (aggregation === "percentage") return "%";
  if (aggregation === "rate") return "taxa";
  const definition = getFootballMetricDefinition(metric, "team");
  if (!definition) return "valor";
  if (definition.unit === "percentage") return "%";
  if (definition.unit === "goals") return "gols";
  return definition.unit === "count" ? "" : definition.unit;
}

function groupDimensions(
  row: ScoreRow,
  fields: readonly FootballGroupByField[],
  scope: QueryScope,
  resolvedSeason: CompetitionSeason | null,
): Partial<Record<FootballGroupByField, string>> {
  const dimensions: Partial<Record<FootballGroupByField, string>> = {};
  for (const field of fields) {
    if (field === "venue") dimensions[field] = row.venue === "home" ? "Casa" : "Fora";
    else if (field === "competition") dimensions[field] = row.fixture.competition;
    else if (field === "opponent") dimensions[field] = row.opponent;
    else if (field === "outcome") dimensions[field] = row.outcome ?? "Desconhecido";
    else if (field === "month") dimensions[field] = row.fixture.date.slice(0, 7);
    else if (field === "year") dimensions[field] = row.fixture.date.slice(0, 4);
    else if (field === "season") {
      dimensions[field] = resolvedSeason?.label ?? scope.season ?? "Desconhecida";
    }
  }
  return dimensions;
}

function groupKey(
  dimensions: Partial<Record<FootballGroupByField, string>>,
  fields: readonly FootballGroupByField[],
): string {
  return fields.map((field) => `${field}:${dimensions[field] ?? "-"}`).join("|");
}

function groupLabel(
  dimensions: Partial<Record<FootballGroupByField, string>>,
  fields: readonly FootballGroupByField[],
): string {
  return fields.map((field) => dimensions[field] ?? "-").join(" · ");
}

function groupRows(params: {
  rows: readonly ScoreRow[];
  values: readonly (number | null)[];
  fields: readonly FootballGroupByField[];
  scope: QueryScope;
  resolvedSeason: CompetitionSeason | null;
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
    const dimensions = groupDimensions(row, params.fields, params.scope, params.resolvedSeason);
    const key = groupKey(dimensions, params.fields);
    const current = grouped.get(key) ?? { dimensions, values: [] };
    current.values.push(params.values[index]);
    grouped.set(key, current);
  });
  const rows = [...grouped.values()].map((entry) => {
    const aggregate = aggregateMetric(params.metric, params.aggregation, entry.values);
    if (aggregate.value === null) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${aggregate.known} de ${entry.values.length} partidas possuem ${params.metric} no grupo ${groupLabel(entry.dimensions, params.fields)}.`,
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
    rows.sort((left, right) => {
      if (params.sort?.field === "sample_size")
        return (left.sample_size - right.sample_size) * direction;
      if (params.sort?.field === "group") return left.key.localeCompare(right.key) * direction;
      return (left.value - right.value) * direction;
    });
  } else {
    rows.sort((left, right) => left.key.localeCompare(right.key));
  }
  return params.limit ? rows.slice(0, params.limit) : rows;
}

function mergeMetas(metas: readonly ProviderReadMeta[]): {
  endpoints: string;
  dataFamilies: string[];
  fetchedAt: string;
  cacheStatus: AnalysisProvenance["cache_status"];
} {
  const endpoints = [...new Set(metas.map((meta) => meta.endpoint))];
  const families = [...new Set(metas.map((meta) => meta.dataFamily))];
  const statuses = [...new Set(metas.map((meta) => meta.cacheStatus))];
  return {
    endpoints: endpoints.join(" + "),
    dataFamilies: families,
    fetchedAt:
      metas
        .map((meta) => meta.fetchedAt)
        .sort()
        .at(-1) ?? new Date().toISOString(),
    cacheStatus: statuses.length === 1 ? statuses[0] : "mixed",
  };
}

function coverageSummary(snapshots: ReadonlyMap<number, NormalizedTeamFixtureStats>) {
  if (snapshots.size === 0) return null;
  const supported = new Set<string>();
  const observed = new Map<string, number>();
  const missing = new Map<string, number>();
  for (const snapshot of snapshots.values()) {
    snapshot.coverage.supported.forEach((metric) => supported.add(metric));
    snapshot.coverage.observed.forEach((metric) => {
      observed.set(metric, (observed.get(metric) ?? 0) + 1);
    });
    snapshot.coverage.missing.forEach((metric) => {
      missing.set(metric, (missing.get(metric) ?? 0) + 1);
    });
  }
  return {
    fixtures: snapshots.size,
    supported: [...supported],
    observed: Object.fromEntries(observed),
    missing: Object.fromEntries(missing),
  };
}

function provenanceFor(params: {
  source: UniversalFootballSource;
  resolved: ResolvedRows;
  stats: SnapshotContext;
  sampleSize: number;
  missingValues: number;
}): AnalysisProvenance {
  const merged = mergeMetas([
    params.resolved.fixtureMeta,
    ...(params.resolved.seasonMeta ? [params.resolved.seasonMeta] : []),
    ...params.stats.metas,
  ]);
  return {
    provider: params.source.name,
    source_endpoint: merged.endpoints,
    data_family: merged.dataFamilies.join(" + "),
    data_families: merged.dataFamilies,
    fetched_at: merged.fetchedAt,
    cache_status: merged.cacheStatus,
    sample_size: params.sampleSize,
    missing_values: params.missingValues,
    resolved_entity_ids: [String(params.resolved.team.id)],
    competition: params.resolved.scope.competition ?? null,
    season: params.resolved.scope.season ?? null,
    coverage: coverageSummary(params.stats.snapshots),
    resolved_competition_id: params.resolved.resolvedSeason?.competitionId ?? null,
    resolved_season_id: params.resolved.resolvedSeason?.seasonId ?? null,
    resolved_season_label: params.resolved.resolvedSeason?.label ?? null,
    providers_attempted: [params.source.name],
    fallback_occurred: false,
  };
}

function fixtureSummary(
  row: ScoreRow,
  source: UniversalFootballSource,
  metric?: { key: FootballMetric; value: number },
): AnalysisFixtureSummary {
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
    ...(metric
      ? {
          metric: {
            key: metric.key,
            value: metric.value,
            unit: metricUnit(metric.key, null),
            observed: true as const,
          },
        }
      : {}),
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

async function prepareFilteredRows(params: {
  source: UniversalFootballSource;
  plan: QueryPlan;
}): Promise<{ resolved: ResolvedRows; filtered: ScoreRow[]; stats: SnapshotContext }> {
  const resolved = await resolveRows(params);
  const filters = splitFilters(params.plan.filters);
  // Score/structural filters are deliberately evaluated before any fixture_stats read.
  const structural = applyStructuralFilters(resolved.rows, filters.structural);
  if (structural.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida do escopo satisfez os filtros estruturais/placar solicitados.",
    );
  }
  const stats = await snapshotsForRows({
    source: params.source,
    team: resolved.team,
    rows: structural,
    requiredMetrics: rawMetricsNeeded(params.plan),
  });
  const filtered = applyStatisticFilters(structural, filters.statistics, stats.snapshots);
  if (filtered.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida do escopo satisfez os filtros fixture_stats solicitados.",
    );
  }
  return { resolved, filtered, stats };
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
      "Métricas desta fase usam jogo completo; primeiro/segundo tempo exige outra família.",
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
  const prepared = await prepareFilteredRows({ source, plan });
  const values = metricValuesForRows({
    rows: prepared.filtered,
    metric: plan.metric,
    execution,
    snapshots: prepared.stats.snapshots,
  });
  const aggregate = aggregateMetric(plan.metric, plan.aggregation, values);
  if (aggregate.value === null) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `${aggregate.known} de ${prepared.filtered.length} partidas possuem ${plan.metric}. UNKNOWN permaneceu desconhecido e a consulta falhou fechada.`,
    );
  }
  const groups = groupRows({
    rows: prepared.filtered,
    values,
    fields: plan.group_by,
    scope: prepared.resolved.scope,
    resolvedSeason: prepared.resolved.resolvedSeason,
    metric: plan.metric,
    aggregation: plan.aggregation,
    sort: plan.sort,
    limit: plan.limit,
  });
  const knownValues = values as number[];
  const definition = getFootballMetricDefinition(plan.metric, "team");
  const label = definition?.label ?? plan.metric;
  const unit = metricUnit(plan.metric, plan.aggregation);
  const groupSummary = groups.length
    ? ` ${groups.map((group) => `${groupLabel(group.dimensions, plan.group_by)}: ${group.value}`).join(" · ")}.`
    : "";
  const summary = `${label}: ${aggregate.value}${unit ? ` ${unit}` : ""} em ${prepared.filtered.length} partida${prepared.filtered.length === 1 ? "" : "s"}.${groupSummary}`;
  const intent: QueryIntent = {
    sport: "football",
    query_kind: "aggregate",
    entity_type: "team",
    entity_name: prepared.resolved.team.name,
    entity_id: String(prepared.resolved.team.id),
    compare_with: null,
    metric: plan.metric,
    metric_label: label,
    aggregation: plan.aggregation as QueryIntent["aggregation"],
    match_count: prepared.filtered.length,
    competition: plan.scope.competition ?? null,
    venue: plan.scope.venue,
  };
  const provenance = provenanceFor({
    source,
    resolved: prepared.resolved,
    stats: prepared.stats,
    sampleSize: prepared.filtered.length,
    missingValues: aggregate.missing,
  });
  const cacheKey = `v5b|${source.name}|${prepared.resolved.team.id}|${queryPlanSignature(plan)}`;
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
      explanation: `Cálculo determinístico sobre ${prepared.filtered.length} partidas. UNKNOWN não vira zero; filtros de placar foram aplicados antes de fixture_stats.`,
    },
    statistics: buildStatistics(knownValues),
    chart_data: prepared.filtered.map((row, index) => ({
      label: new Date(row.fixture.date).toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
      }),
      value: knownValues[index],
      opponent: row.opponent,
      venue: row.venue === "home" ? "Casa" : "Fora",
    })),
    matches: [...prepared.filtered]
      .map((row, index) => matchRecord(row, knownValues[index], source))
      .reverse(),
    insights: groups.length
      ? groups.map(
          (group) =>
            `${groupLabel(group.dimensions, plan.group_by)}: ${group.value} (${group.sample_size} jogos).`,
        )
      : [`A amostra efetiva contém ${prepared.filtered.length} partidas após scope e filtros.`],
    related: [
      `Compare ${label.toLowerCase()} de ${prepared.resolved.team.name} em casa e fora`,
      `Mostre os jogos usados nesta análise do ${prepared.resolved.team.name}`,
    ],
    source: {
      provider: source.name,
      updated_at: provenance.fetched_at,
      missing: aggregate.missing,
    },
    provenance,
    demo: false,
  };
}

async function analyzeMatchList(params: {
  question: string;
  plan: QueryPlan;
  source: UniversalFootballSource;
}): Promise<MatchListAnalysisResult> {
  if (params.plan.sort) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      "sort em match_list ainda não possui executor determinístico e foi recusado para evitar perda semântica.",
    );
  }
  const prepared = await prepareFilteredRows({ source: params.source, plan: params.plan });
  const limited = params.plan.limit
    ? prepared.filtered.slice(-params.plan.limit)
    : prepared.filtered;
  if (limited.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma partida satisfez a lista solicitada.",
    );
  }
  let values: (number | null)[] | null = null;
  if (params.plan.metric) {
    const execution = resolveTeamMetricExecution(params.plan.metric);
    if (execution.kind === "unsupported") {
      throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", execution.reason);
    }
    values = metricValuesForRows({
      rows: limited,
      metric: params.plan.metric,
      execution,
      snapshots: prepared.stats.snapshots,
    });
    const missing = values.filter((value) => value === null).length;
    if (missing > 0) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `${missing} partida(s) não possuem ${params.plan.metric}; match_list recusou ocultar a métrica ou inventar zero.`,
      );
    }
  }
  const summaries = limited.map((row, index) =>
    fixtureSummary(
      row,
      params.source,
      params.plan.metric && values
        ? { key: params.plan.metric, value: values[index] as number }
        : undefined,
    ),
  );
  const intent: UniversalAnalysisIntent = {
    sport: "football",
    query_kind: "match_list",
    entity_type: "team",
    entity_name: prepared.resolved.team.name,
    entity_id: String(prepared.resolved.team.id),
    compare_with: null,
    metric: params.plan.metric ?? null,
    aggregation: params.plan.aggregation ?? null,
    match_count: limited.length,
    competition: params.plan.scope.competition ?? null,
    venue: params.plan.scope.venue,
    status: "finished",
  };
  const provenance = provenanceFor({
    source: params.source,
    resolved: prepared.resolved,
    stats: prepared.stats,
    sampleSize: limited.length,
    missingValues: values ? values.filter((value) => value === null).length : 0,
  });
  const cacheKey = `v5b|${params.source.name}|${prepared.resolved.team.id}|${queryPlanSignature(params.plan)}`;
  return {
    result_type: "match_list",
    id: `${cacheKey}-${Date.now()}`,
    cache_key: cacheKey,
    question: params.question,
    created_at: new Date().toISOString(),
    intent: intent as MatchListAnalysisResult["intent"],
    team: { id: String(prepared.resolved.team.id), name: prepared.resolved.team.name },
    matches: summaries,
    related: [
      `Qual foi a média de gols sofridos do ${prepared.resolved.team.name} nessa amostra?`,
      `Em quantos desses jogos o ${prepared.resolved.team.name} não sofreu gol?`,
    ],
    source: {
      provider: params.source.name,
      updated_at: provenance.fetched_at,
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
      `A Phase 5B não executa ${plan.entity.type}/${plan.query_kind} neste executor.`,
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
  allowedProviders?: readonly UniversalProviderName[];
}): Promise<Phase4cTeamResult> {
  return analyzePhase4cUniversalTeamPlanWithSources({
    ...params,
    sources: createUniversalFootballSources(params.observer, params.allowedProviders),
  });
}
