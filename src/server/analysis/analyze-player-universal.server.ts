import type { MatchRecord } from "@/data/sports";
import type { AggregateAnalysisResult, AnalysisStatistics, QueryIntent } from "@/lib/analysis";
import type { AnalysisOverrides } from "@/lib/analysis-request";
import type {
  AnalysisFixtureSummary,
  AnalysisProvenance,
  MatchListAnalysisResult,
  UniversalAnalysisIntent,
} from "@/lib/universal-analysis";
import {
  canonicalizeCompetitionName,
  normalizeCompetitionText,
  type CompetitionSeason,
} from "@/server/sports/competition-season-registry";
import {
  getFootballMetricDefinition,
  PLAYER_METRIC_KEYS,
  type PlayerMetricKey,
} from "@/server/sports/metric-catalog";
import {
  playerMatchStatValue,
  type NormalizedPlayerMatchStats,
} from "@/server/sports/player-match-stats";
import type { ResolvedPlayer } from "@/server/sports/player-provider";
import {
  BsdUniversalPlayerSource,
  competitionSeasonContains,
} from "@/server/sports/universal-player.server";
import type { ProviderReadMeta } from "@/server/sports/universal-football";

import { aggregateNumericValues } from "./aggregation";
import { AnalysisPipelineError } from "./errors";
import {
  queryPlanSchema,
  queryPlanSignature,
  type FootballAggregation,
  type FootballGroupByField,
  type QueryFilter,
  type QueryPlan,
} from "./query-plan";

const PLAYER_METRICS = new Set<string>(PLAYER_METRIC_KEYS);

type PlayerSource = Pick<
  BsdUniversalPlayerSource,
  "resolvePlayer" | "listPlayerSnapshots" | "resolveCompetitionSeason"
>;

export interface PlayerGroupedAggregateRow {
  key: string;
  dimensions: Partial<Record<FootballGroupByField, string>>;
  value: number;
  sample_size: number;
}

export type Phase5cPlayerAggregateResult = AggregateAnalysisResult & {
  result_type: "aggregate";
  result_version: 5;
  result_kind: "aggregate" | "grouped_aggregate";
  query_plan: QueryPlan;
  groups: PlayerGroupedAggregateRow[];
  provenance: AnalysisProvenance;
};

export type Phase5cPlayerResult = Phase5cPlayerAggregateResult | MatchListAnalysisResult;

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function applyOverrides(plan: QueryPlan, overrides?: AnalysisOverrides): QueryPlan {
  if (!overrides) return plan;
  return queryPlanSchema.parse({
    ...plan,
    scope: {
      ...plan.scope,
      ...(overrides.match_count !== undefined ? { last_matches: overrides.match_count } : {}),
      ...(overrides.venue !== undefined ? { venue: overrides.venue } : {}),
      ...(Object.prototype.hasOwnProperty.call(overrides, "competition")
        ? overrides.competition
          ? { competition: canonicalizeCompetitionName(overrides.competition) }
          : { competition: undefined, season: undefined }
        : {}),
    },
  });
}

function scoreParts(result: string): { home: number | null; away: number | null } {
  const match = result.match(/^(\d+)-(\d+)$/);
  return match ? { home: Number(match[1]), away: Number(match[2]) } : { home: null, away: null };
}

function structuralScope(
  snapshots: readonly NormalizedPlayerMatchStats[],
  plan: QueryPlan,
  season: CompetitionSeason | null,
): NormalizedPlayerMatchStats[] {
  const competition = plan.scope.competition ? normalizeCompetitionText(plan.scope.competition) : null;
  const opponent = plan.scope.opponent ? normalize(plan.scope.opponent) : null;
  const from = plan.scope.date_from ? Date.parse(`${plan.scope.date_from}T00:00:00Z`) / 1000 : null;
  const to = plan.scope.date_to ? Date.parse(`${plan.scope.date_to}T23:59:59Z`) / 1000 : null;

  return snapshots
    .filter((row) => row.participated)
    .filter((row) => plan.scope.venue === "all" || row.venue === plan.scope.venue)
    .filter(
      (row) =>
        !competition || normalizeCompetitionText(row.competitionName) === competition,
    )
    .filter((row) => !opponent || normalize(row.opponentName) === opponent)
    .filter((row) => from === null || row.timestamp >= from)
    .filter((row) => to === null || row.timestamp <= to)
    .filter((row) => !season || competitionSeasonContains(row, season))
    .sort((left, right) => left.timestamp - right.timestamp);
}

function takeLastAppearances(
  rows: readonly NormalizedPlayerMatchStats[],
  lastMatches: number | undefined,
): NormalizedPlayerMatchStats[] {
  if (!lastMatches) return [...rows];
  return rows.slice(-lastMatches);
}

function compareNumeric(value: number, filter: QueryFilter): boolean {
  if (filter.operator === "in") {
    return Array.isArray(filter.value) && filter.value.some((candidate) => candidate === value);
  }
  if (typeof filter.value !== "number") return false;
  if (filter.operator === "eq") return value === filter.value;
  if (filter.operator === "neq") return value !== filter.value;
  if (filter.operator === "gt") return value > filter.value;
  if (filter.operator === "gte") return value >= filter.value;
  if (filter.operator === "lt") return value < filter.value;
  return value <= filter.value;
}

function compareString(value: string, filter: QueryFilter): boolean {
  const actual = normalize(value);
  if (filter.operator === "in") {
    return (
      Array.isArray(filter.value) &&
      filter.value.some((candidate) => typeof candidate === "string" && normalize(candidate) === actual)
    );
  }
  if (typeof filter.value !== "string") return false;
  const expected = normalize(filter.value);
  return filter.operator === "neq" ? actual !== expected : actual === expected;
}

function structuralFilterValue(
  row: NormalizedPlayerMatchStats,
  field: QueryFilter["field"],
): string | null {
  if (field === "outcome") return row.outcome;
  if (field === "venue") return row.venue;
  if (field === "competition") return row.competitionName;
  if (field === "opponent") return row.opponentName;
  return null;
}

export function applyPlayerFilters(
  rows: readonly NormalizedPlayerMatchStats[],
  filters: readonly QueryFilter[],
): NormalizedPlayerMatchStats[] {
  let current = [...rows];
  for (const filter of filters) {
    if (PLAYER_METRICS.has(filter.field)) {
      const metric = filter.field as PlayerMetricKey;
      const values = current.map((row) => playerMatchStatValue(row, metric));
      if (values.some((value) => !value.observed || value.value === null)) {
        throw new AnalysisPipelineError(
          "DATA_INSUFFICIENT",
          `O filtro ${metric} exige cobertura completa na amostra selecionada; pelo menos uma aparição possui valor UNKNOWN.`,
        );
      }
      current = current.filter((_, index) => compareNumeric(values[index].value as number, filter));
      continue;
    }

    const unknown = current.some((row) => structuralFilterValue(row, filter.field) === null);
    if (unknown) {
      throw new AnalysisPipelineError(
        "DATA_INSUFFICIENT",
        `O filtro ${filter.field} não possui truth completa para todas as aparições da amostra.`,
      );
    }
    current = current.filter((row) =>
      compareString(structuralFilterValue(row, filter.field) as string, filter),
    );
  }
  return current;
}

function metricValues(
  rows: readonly NormalizedPlayerMatchStats[],
  metric: PlayerMetricKey,
): number[] {
  const values = rows.map((row) => playerMatchStatValue(row, metric));
  if (values.some((value) => !value.observed || value.value === null)) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A métrica ${metric} possui UNKNOWN em pelo menos uma aparição da amostra final; nenhuma partida foi descartada silenciosamente.`,
    );
  }
  return values.map((value) => value.value as number);
}

function aggregate(values: readonly number[], aggregation: FootballAggregation): number {
  if (["percentage", "rate"].includes(aggregation)) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `${aggregation} exige denominador semântico explícito para jogador.`,
    );
  }
  const result = aggregateNumericValues(
    values,
    aggregation as Exclude<FootballAggregation, "percentage" | "rate">,
  );
  if (result.value === null) {
    throw new AnalysisPipelineError("DATA_INSUFFICIENT", "Não há valores observados para agregar.");
  }
  return result.value;
}

function dimension(row: NormalizedPlayerMatchStats, field: FootballGroupByField): string | null {
  if (field === "venue") return row.venue;
  if (field === "competition") return row.competitionName;
  if (field === "season") return row.seasonLabel ?? row.seasonId ?? null;
  if (field === "opponent") return row.opponentName;
  if (field === "outcome") return row.outcome;
  const date = new Date(row.timestamp * 1000);
  if (field === "month") return date.toISOString().slice(0, 7);
  if (field === "year") return String(date.getUTCFullYear());
  return null;
}

export function groupPlayerRows(
  rows: readonly NormalizedPlayerMatchStats[],
  plan: QueryPlan,
  metric: PlayerMetricKey,
): PlayerGroupedAggregateRow[] {
  if (plan.group_by.length === 0) return [];
  const buckets = new Map<string, { rows: NormalizedPlayerMatchStats[]; dimensions: Partial<Record<FootballGroupByField, string>> }>();
  for (const row of rows) {
    const dimensions: Partial<Record<FootballGroupByField, string>> = {};
    for (const field of plan.group_by) {
      const value = dimension(row, field);
      if (value === null) {
        throw new AnalysisPipelineError(
          "DATA_INSUFFICIENT",
          `group_by ${field} não possui truth completa para todas as aparições.`,
        );
      }
      dimensions[field] = value;
    }
    const key = plan.group_by.map((field) => `${field}=${dimensions[field]}`).join("|");
    const bucket = buckets.get(key) ?? { rows: [], dimensions };
    bucket.rows.push(row);
    buckets.set(key, bucket);
  }

  let groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    dimensions: bucket.dimensions,
    value: aggregate(metricValues(bucket.rows, metric), plan.aggregation ?? "average"),
    sample_size: bucket.rows.length,
  }));

  if (plan.sort) {
    const sign = plan.sort.direction === "asc" ? 1 : -1;
    groups = groups.sort((left, right) => {
      if (plan.sort?.field === "sample_size") return sign * (left.sample_size - right.sample_size);
      if (plan.sort?.field === "group") return sign * left.key.localeCompare(right.key);
      return sign * (left.value - right.value);
    });
  }
  if (plan.limit) groups = groups.slice(0, plan.limit);
  return groups;
}

function statistics(values: readonly number[]): AnalysisStatistics {
  const average = aggregate(values, "average");
  const median = aggregate(values, "median");
  const total = aggregate(values, "total");
  const maximum = aggregate(values, "maximum");
  const minimum = aggregate(values, "minimum");
  const recent = values.slice(-Math.min(5, values.length));
  const trend = Math.round((aggregate(recent, "average") - average) * 100) / 100;
  return { average, median, total, maximum, minimum, sample_size: values.length, trend };
}

function provenance(
  player: ResolvedPlayer,
  rows: readonly NormalizedPlayerMatchStats[],
  meta: ProviderReadMeta,
  plan: QueryPlan,
  season: CompetitionSeason | null,
  requiredMetrics: readonly PlayerMetricKey[],
): AnalysisProvenance {
  const observed: Record<string, number> = {};
  const missing: Record<string, number> = {};
  for (const metric of requiredMetrics) {
    const values = rows.map((row) => playerMatchStatValue(row, metric));
    observed[metric] = values.filter((value) => value.observed && value.value !== null).length;
    missing[metric] = values.length - observed[metric];
  }
  return {
    provider: meta.provider,
    source_endpoint: meta.endpoint,
    data_family: "player_match_stats",
    fetched_at: meta.fetchedAt,
    cache_status: meta.cacheStatus,
    sample_size: rows.length,
    missing_values: Object.values(missing).reduce((sum, value) => sum + value, 0),
    resolved_entity_ids: [`BSD:${player.id}`],
    competition: plan.scope.competition ?? null,
    season: plan.scope.season ?? null,
    providers_attempted: ["BSD"],
    fallback_occurred: false,
    data_families: ["fixtures", "player_match_stats", ...(season ? ["league_season"] : [])],
    coverage: {
      fixtures: rows.length,
      supported: [...requiredMetrics],
      observed,
      missing,
    },
    resolved_competition_id: season?.competitionId ?? null,
    resolved_season_id: season?.seasonId ?? null,
    resolved_season_label: season?.label ?? null,
  };
}

async function resolveSeason(
  source: PlayerSource,
  plan: QueryPlan,
): Promise<{ season: CompetitionSeason | null; meta: ProviderReadMeta | null }> {
  if (!plan.scope.season) return { season: null, meta: null };
  if (!plan.scope.competition) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_FILTER",
      "Temporada de jogador exige competição explícita para resolução provider-backed.",
    );
  }
  const resolved = await source.resolveCompetitionSeason(plan.scope.competition, plan.scope.season);
  return { season: resolved.season, meta: resolved.meta };
}

function requiredMetrics(plan: QueryPlan): PlayerMetricKey[] {
  const metrics = new Set<PlayerMetricKey>();
  if (plan.metric && PLAYER_METRICS.has(plan.metric)) metrics.add(plan.metric as PlayerMetricKey);
  for (const filter of plan.filters) {
    if (PLAYER_METRICS.has(filter.field)) metrics.add(filter.field as PlayerMetricKey);
  }
  return [...metrics];
}

function prepareRows(
  snapshots: readonly NormalizedPlayerMatchStats[],
  plan: QueryPlan,
  season: CompetitionSeason | null,
): { sample: NormalizedPlayerMatchStats[]; filtered: NormalizedPlayerMatchStats[] } {
  const scoped = structuralScope(snapshots, plan, season);
  const sample = takeLastAppearances(scoped, plan.scope.last_matches);
  if (sample.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma aparição real do jogador corresponde ao escopo solicitado.",
    );
  }
  const filtered = applyPlayerFilters(sample, plan.filters);
  if (filtered.length === 0) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      "Nenhuma aparição da amostra satisfez todos os filtros AND solicitados.",
    );
  }
  return { sample, filtered };
}

function playerIntent(
  player: ResolvedPlayer,
  plan: QueryPlan,
  metric: PlayerMetricKey,
  label: string,
): QueryIntent {
  return {
    sport: "football",
    query_kind: "aggregate",
    entity_type: "player",
    entity_name: player.name,
    entity_id: String(player.id),
    compare_with: null,
    metric,
    metric_label: label,
    aggregation: (plan.aggregation ?? "average") as QueryIntent["aggregation"],
    match_count: plan.scope.last_matches ?? 10,
    competition: plan.scope.competition ?? null,
    venue: plan.scope.venue,
  };
}

function matchRecord(row: NormalizedPlayerMatchStats, value: number): MatchRecord {
  return {
    id: String(row.fixtureId),
    date: row.date,
    opponent: row.opponentName,
    competition: row.competitionName,
    venue: row.venue,
    result: row.result,
    outcome: row.outcome === "win" ? "V" : row.outcome === "draw" ? "E" : "D",
    value,
    source: row.provenance.provider,
  };
}

export async function executePlayerAggregate(
  question: string,
  inputPlan: QueryPlan,
  overrides?: AnalysisOverrides,
  source: PlayerSource = new BsdUniversalPlayerSource(),
): Promise<Phase5cPlayerAggregateResult> {
  const plan = applyOverrides(inputPlan, overrides);
  if (plan.entity.type !== "player" || plan.query_kind !== "aggregate" || !plan.metric) {
    throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", "ExecutionPlan não é um aggregate de jogador.");
  }
  if (!PLAYER_METRICS.has(plan.metric)) {
    throw new AnalysisPipelineError("UNSUPPORTED_METRIC", `${plan.metric} não é métrica de jogador.`);
  }
  const metric = plan.metric as PlayerMetricKey;
  const player = await source.resolvePlayer(plan.entity.name);
  const read = await source.listPlayerSnapshots(player);
  const seasonRead = await resolveSeason(source, plan);
  const { filtered } = prepareRows(read.snapshots, plan, seasonRead.season);
  const values = metricValues(filtered, metric);
  const requestedValue = aggregate(values, plan.aggregation ?? "average");
  const metricDef = getFootballMetricDefinition(metric, "player");
  const label = metricDef?.label ?? metric;
  const groups = groupPlayerRows(filtered, plan, metric);
  const stats = statistics(values);
  const queryPlan = queryPlanSchema.parse(plan);
  const required = requiredMetrics(plan);
  const resultProvenance = provenance(player, filtered, read.meta, plan, seasonRead.season, required);
  if (seasonRead.meta) resultProvenance.data_families = [...new Set([...(resultProvenance.data_families ?? []), seasonRead.meta.dataFamily])];

  const matchRows = filtered.map((row, index) => matchRecord(row, values[index]));
  const chartData = groups.length
    ? groups.map((group) => ({ label: group.key, value: group.value, opponent: "", venue: "" }))
    : filtered.map((row, index) => ({
        label: new Date(row.date).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
        value: values[index],
        opponent: row.opponentName,
        venue: row.venue,
      }));
  const aggregationLabel = plan.aggregation ?? "average";
  const groupSummary = groups.length
    ? ` ${groups.length} grupo(s) foram calculados após a agregação, ordenação e limite solicitados.`
    : "";

  return {
    result_type: "aggregate",
    result_version: 5,
    result_kind: groups.length ? "grouped_aggregate" : "aggregate",
    id: crypto.randomUUID(),
    cache_key: `phase5c|${queryPlanSignature(queryPlan)}`,
    question,
    created_at: new Date().toISOString(),
    intent: playerIntent(player, plan, metric, label),
    player: { name: player.name, team_name: player.teamName, position: player.position },
    answer: {
      value: requestedValue,
      unit: metricDef?.unit ?? "count",
      summary: `${aggregationLabel} de ${label}: ${requestedValue}`,
      explanation: `${filtered.length} aparição(ões) reais foram usadas; UNKNOWN não foi convertido em zero.${groupSummary}`,
    },
    statistics: stats,
    chart_data: chartData,
    matches: matchRows,
    insights: [
      `A amostra final contém ${filtered.length} aparição(ões) reais do jogador.`,
      `Fonte final: ${read.meta.provider}; família: player_match_stats.`,
      `Cobertura requerida: ${required.join(", ") || metric}.`,
    ],
    related: [
      `Liste os últimos ${Math.min(plan.scope.last_matches ?? 10, 10)} jogos de ${player.name} mostrando ${label}.`,
      `Qual a média de ${label} de ${player.name} fora de casa?`,
    ],
    source: { provider: read.meta.provider, updated_at: read.meta.fetchedAt, missing: 0 },
    demo: false,
    query_plan: queryPlan,
    groups,
    provenance: resultProvenance,
  };
}

function fixtureSummary(
  row: NormalizedPlayerMatchStats,
  metric: PlayerMetricKey | null,
): AnalysisFixtureSummary {
  const score = scoreParts(row.result);
  const output = metric ? playerMatchStatValue(row, metric) : null;
  if (metric && (!output?.observed || output.value === null)) {
    throw new AnalysisPipelineError(
      "DATA_INSUFFICIENT",
      `A métrica ${metric} está UNKNOWN na partida ${row.fixtureId}; match_list não inventa zero.`,
    );
  }
  const team = { id: String(row.teamId), name: row.teamName };
  const opponent = { id: String(row.opponentId), name: row.opponentName };
  return {
    fixture_id: String(row.fixtureId),
    date: row.date,
    status: "finished",
    competition: row.competitionName,
    home_team: row.venue === "home" ? team : opponent,
    away_team: row.venue === "away" ? team : opponent,
    home_goals: score.home,
    away_goals: score.away,
    opponent: row.opponentName,
    venue: row.venue,
    result: row.result,
    outcome: row.outcome === "win" ? "V" : row.outcome === "draw" ? "E" : row.outcome === "loss" ? "D" : null,
    source: row.provenance.provider,
    metric:
      metric && output
        ? {
            key: metric,
            value: output.value as number,
            unit: output.unit,
            observed: true,
          }
        : null,
  };
}

export async function executePlayerMatchList(
  question: string,
  inputPlan: QueryPlan,
  overrides?: AnalysisOverrides,
  source: PlayerSource = new BsdUniversalPlayerSource(),
): Promise<MatchListAnalysisResult> {
  const plan = applyOverrides(inputPlan, overrides);
  if (plan.entity.type !== "player" || plan.query_kind !== "match_list") {
    throw new AnalysisPipelineError("UNSUPPORTED_CAPABILITY", "ExecutionPlan não é match_list de jogador.");
  }
  const metric = plan.metric && PLAYER_METRICS.has(plan.metric) ? (plan.metric as PlayerMetricKey) : null;
  const player = await source.resolvePlayer(plan.entity.name);
  const read = await source.listPlayerSnapshots(player);
  const seasonRead = await resolveSeason(source, plan);
  const { filtered } = prepareRows(read.snapshots, plan, seasonRead.season);
  if (metric) metricValues(filtered, metric);
  const rows = plan.limit ? filtered.slice(-plan.limit) : filtered;
  const required = requiredMetrics(plan);
  const resultProvenance = provenance(player, rows, read.meta, plan, seasonRead.season, required);
  const intent: UniversalAnalysisIntent = {
    sport: "football",
    query_kind: "match_list",
    entity_type: "player",
    entity_name: player.name,
    entity_id: String(player.id),
    metric,
    aggregation: null,
    match_count: plan.scope.last_matches ?? rows.length,
    competition: plan.scope.competition ?? null,
    venue: plan.scope.venue,
    status: "finished",
  };
  return {
    result_type: "match_list",
    id: crypto.randomUUID(),
    cache_key: `phase5c|${queryPlanSignature(plan)}`,
    question,
    created_at: new Date().toISOString(),
    intent,
    team: {
      id: String(player.teamId ?? player.id),
      name: player.teamName ?? player.name,
    },
    player: { id: String(player.id), name: player.name },
    matches: rows.map((row) => fixtureSummary(row, metric)),
    related: [
      metric
        ? `Qual a média de ${getFootballMetricDefinition(metric, "player")?.label ?? metric} de ${player.name}?`
        : `Qual a média de gols de ${player.name}?`,
    ],
    source: { provider: read.meta.provider, updated_at: read.meta.fetchedAt, missing: 0 },
    provenance: resultProvenance,
    demo: false,
  };
}
