import {
  getFootballMetricDefinition,
  TEAM_METRIC_KEYS,
  type MetricProvider,
  type TeamMetric,
} from "./metric-catalog";
import type { ProviderFixture } from "./provider";
import { asRecord, readNumber, readString, type UniversalProviderName } from "./universal-football";

export interface NormalizedFixtureStatValue {
  value: number | null;
  observed: boolean;
  source: UniversalProviderName;
  unit: string;
  rawLabel: string | null;
}

export interface FixtureStatsCoverage {
  supported: readonly TeamMetric[];
  observed: readonly TeamMetric[];
  missing: readonly TeamMetric[];
}

export interface NormalizedTeamFixtureStats {
  fixtureId: number;
  teamId: number;
  opponentId: number;
  provider: UniversalProviderName;
  competitionId: string | null;
  seasonId: string | null;
  values: Partial<Record<TeamMetric, NormalizedFixtureStatValue>>;
  coverage: FixtureStatsCoverage;
  fetchedAt: string;
}

function catalogProvider(provider: UniversalProviderName): MetricProvider {
  return provider === "BSD" ? "BSD" : "API_FOOTBALL";
}

export function mappedFixtureStatMetrics(provider: UniversalProviderName): TeamMetric[] {
  const catalog = catalogProvider(provider);
  return TEAM_METRIC_KEYS.filter((metric) => {
    const mapping = getFootballMetricDefinition(metric, "team")?.providers[catalog];
    return mapping?.dataFamily === "fixture_stats";
  });
}

export function providerSupportsFixtureStatMetric(
  provider: UniversalProviderName,
  metric: TeamMetric,
): boolean {
  return mappedFixtureStatMetrics(provider).includes(metric);
}

interface ParsedValue {
  value: number | null;
  observed: boolean;
}

export function readFixtureStatNumber(value: unknown): ParsedValue {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { value, observed: true };
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.replace("%", "").trim();
    if (!normalized || ["null", "n/a", "na", "-"].includes(normalized.toLowerCase())) {
      return { value: null, observed: false };
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed)
      ? { value: parsed, observed: true }
      : { value: null, observed: false };
  }
  const record = asRecord(value);
  if (record) {
    for (const key of ["actual", "value", "total"]) {
      if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
      const parsed = readFixtureStatNumber(record[key]);
      if (parsed.observed) return parsed;
    }
  }
  return { value: null, observed: false };
}

function valueFromFields(
  record: Record<string, unknown>,
  fields: readonly string[],
): { parsed: ParsedValue; rawLabel: string | null } {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const parsed = readFixtureStatNumber(record[field]);
    if (parsed.observed) return { parsed, rawLabel: field };
    // The provider exposed the field but did not expose a numeric value. That remains UNKNOWN.
    return { parsed, rawLabel: field };
  }
  return { parsed: { value: null, observed: false }, rawLabel: null };
}

function unitFor(metric: TeamMetric): string {
  const unit = getFootballMetricDefinition(metric, "team")?.unit ?? "count";
  if (unit === "percentage") return "%";
  if (unit === "minutes") return "min";
  return unit;
}

function coverageFor(
  supported: readonly TeamMetric[],
  values: Partial<Record<TeamMetric, NormalizedFixtureStatValue>>,
): FixtureStatsCoverage {
  const observed = supported.filter((metric) => values[metric]?.observed === true);
  return {
    supported: [...supported],
    observed,
    missing: supported.filter((metric) => !observed.includes(metric)),
  };
}

function normalizeFromRecord(params: {
  provider: UniversalProviderName;
  fixture: ProviderFixture;
  teamId: number;
  record: Record<string, unknown>;
  fetchedAt?: string;
}): NormalizedTeamFixtureStats {
  const supported = mappedFixtureStatMetrics(params.provider);
  const values: Partial<Record<TeamMetric, NormalizedFixtureStatValue>> = {};
  const catalog = catalogProvider(params.provider);

  for (const metric of supported) {
    const mapping = getFootballMetricDefinition(metric, "team")?.providers[catalog];
    if (!mapping || mapping.dataFamily !== "fixture_stats") continue;
    const { parsed, rawLabel } = valueFromFields(params.record, mapping.fields);
    values[metric] = {
      value: parsed.value,
      observed: parsed.observed,
      source: params.provider,
      unit: unitFor(metric),
      rawLabel,
    };
  }

  if (supported.includes("cards")) {
    const yellow = values.yellow_cards;
    const red = values.red_cards;
    const observed = yellow?.observed === true && red?.observed === true;
    values.cards = {
      value: observed ? (yellow.value as number) + (red.value as number) : null,
      observed,
      source: params.provider,
      unit: unitFor("cards"),
      rawLabel: observed ? "yellow_cards + red_cards" : null,
    };
  }

  const isHome = params.fixture.home.id === params.teamId;
  return {
    fixtureId: params.fixture.id,
    teamId: params.teamId,
    opponentId: isHome ? params.fixture.away.id : params.fixture.home.id,
    provider: params.provider,
    competitionId: params.fixture.competitionId ?? null,
    seasonId: params.fixture.seasonId ?? null,
    values,
    coverage: coverageFor(supported, values),
    fetchedAt: params.fetchedAt ?? new Date().toISOString(),
  };
}

function bsdSideStats(payload: unknown, fixture: ProviderFixture, teamId: number) {
  const root = asRecord(payload);
  const stats = root ? asRecord(root.stats) : null;
  if (!stats) return null;
  if (fixture.home.id === teamId) return asRecord(stats.home);
  if (fixture.away.id === teamId) return asRecord(stats.away);
  return null;
}

function bsdShotmapMetrics(
  payload: unknown,
  fixture: ProviderFixture,
  teamId: number,
): { shots: number; shotsOnTarget: number } | null {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.shotmap)) return null;
  const isHome = fixture.home.id === teamId;
  const shots = root.shotmap
    .map(asRecord)
    .filter((shot): shot is Record<string, unknown> => shot !== null)
    .filter((shot) => {
      const situation = (readString(shot, ["sit", "situation"]) ?? "").toLowerCase();
      if (situation.includes("shootout")) return false;
      const rawHome = shot.home ?? shot.is_home;
      const home = typeof rawHome === "boolean" ? rawHome : rawHome === 1 || rawHome === "1";
      return home === isHome;
    });
  // An absent/empty shotmap is not treated as an explicit zero. The regular stats fields can
  // still provide a proven zero; otherwise the metric remains UNKNOWN.
  if (shots.length === 0) return null;
  return {
    shots: shots.length,
    shotsOnTarget: shots.filter((shot) => {
      const type = (readString(shot, ["type", "shot_type"]) ?? "").toLowerCase();
      return ["goal", "save", "saved", "on target", "on_target"].includes(type);
    }).length,
  };
}

export function normalizeBsdFixtureStats(
  payload: unknown,
  fixture: ProviderFixture,
  teamId: number,
  fetchedAt?: string,
): NormalizedTeamFixtureStats {
  const side = bsdSideStats(payload, fixture, teamId) ?? {};
  const normalized = normalizeFromRecord({
    provider: "BSD",
    fixture,
    teamId,
    record: side,
    fetchedAt,
  });
  const shotmap = bsdShotmapMetrics(payload, fixture, teamId);
  if (shotmap) {
    normalized.values.shots = {
      value: shotmap.shots,
      observed: true,
      source: "BSD",
      unit: unitFor("shots"),
      rawLabel: "shotmap",
    };
    normalized.values.shots_on_target = {
      value: shotmap.shotsOnTarget,
      observed: true,
      source: "BSD",
      unit: unitFor("shots_on_target"),
      rawLabel: "shotmap:type",
    };
    normalized.coverage = coverageFor(normalized.coverage.supported, normalized.values);
  }
  return normalized;
}

function apiTeamStatistics(payload: unknown, teamId: number): Record<string, unknown> | null {
  const root = asRecord(payload);
  const response = root && Array.isArray(root.response) ? root.response : [];
  for (const item of response) {
    const block = asRecord(item);
    if (!block) continue;
    const team = asRecord(block.team);
    if (team && readNumber(team, ["id"]) !== teamId) continue;
    if (!Array.isArray(block.statistics)) continue;
    const record: Record<string, unknown> = {};
    for (const statValue of block.statistics) {
      const stat = asRecord(statValue);
      if (!stat) continue;
      const type = readString(stat, ["type"]);
      if (!type) continue;
      // Preserve raw values (including the string "0%") so normalization can distinguish an
      // observed zero from a missing/null value.
      record[type] = stat.value;
    }
    return record;
  }
  return null;
}

export function normalizeApiFootballFixtureStats(
  payload: unknown,
  fixture: ProviderFixture,
  teamId: number,
  fetchedAt?: string,
): NormalizedTeamFixtureStats {
  return normalizeFromRecord({
    provider: "API-FOOTBALL",
    fixture,
    teamId,
    record: apiTeamStatistics(payload, teamId) ?? {},
    fetchedAt,
  });
}

export function fixtureStatValue(
  snapshot: NormalizedTeamFixtureStats | null | undefined,
  metric: TeamMetric,
): number | null {
  const entry = snapshot?.values[metric];
  if (!entry?.observed) return null;
  return typeof entry.value === "number" && Number.isFinite(entry.value) ? entry.value : null;
}
