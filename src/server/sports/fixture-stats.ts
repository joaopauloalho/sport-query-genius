import {
  getFootballMetricDefinition,
  TEAM_METRIC_KEYS,
  type MetricProvider,
  type TeamMetric,
} from "./metric-catalog";
import type { ProviderFixture } from "./provider";
import { asRecord, readNumber, readString, type UniversalProviderName } from "./universal-football";

export interface FixtureStatsCoverage {
  supported: readonly TeamMetric[];
  known: readonly TeamMetric[];
  missing: readonly TeamMetric[];
}

export interface NormalizedTeamFixtureStats {
  fixtureId: number;
  teamId: number;
  opponentId: number;
  metrics: Partial<Record<TeamMetric, number | null>>;
  metricProviders: Partial<Record<TeamMetric, UniversalProviderName>>;
  coverage: FixtureStatsCoverage;
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

function readNumberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace("%", "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  const record = asRecord(value);
  if (record) {
    for (const key of ["actual", "value", "total"]) {
      const parsed = readNumberValue(record[key]);
      if (parsed !== null) return parsed;
    }
  }
  return null;
}

function valueFromFields(record: Record<string, unknown>, fields: readonly string[]): number | null {
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    const value = readNumberValue(record[field]);
    if (value !== null) return value;
  }
  return null;
}

function coverageFor(
  supported: readonly TeamMetric[],
  metrics: Partial<Record<TeamMetric, number | null>>,
): FixtureStatsCoverage {
  const known = supported.filter(
    (metric) => metrics[metric] !== null && metrics[metric] !== undefined,
  );
  return {
    supported: [...supported],
    known,
    missing: supported.filter((metric) => !known.includes(metric)),
  };
}

function normalizeFromRecord(params: {
  provider: UniversalProviderName;
  fixture: ProviderFixture;
  teamId: number;
  record: Record<string, unknown>;
}): NormalizedTeamFixtureStats {
  const supported = mappedFixtureStatMetrics(params.provider);
  const metrics: Partial<Record<TeamMetric, number | null>> = {};
  const metricProviders: Partial<Record<TeamMetric, UniversalProviderName>> = {};
  const catalog = catalogProvider(params.provider);

  for (const metric of supported) {
    const mapping = getFootballMetricDefinition(metric, "team")?.providers[catalog];
    if (!mapping || mapping.dataFamily !== "fixture_stats") continue;
    const value = valueFromFields(params.record, mapping.fields);
    metrics[metric] = value;
    if (value !== null) metricProviders[metric] = params.provider;
  }

  const yellow = metrics.yellow_cards;
  const red = metrics.red_cards;
  if (supported.includes("cards")) {
    metrics.cards = yellow !== null && yellow !== undefined && red !== null && red !== undefined
      ? yellow + red
      : null;
    if (metrics.cards !== null) metricProviders.cards = params.provider;
  }

  const isHome = params.fixture.home.id === params.teamId;
  return {
    fixtureId: params.fixture.id,
    teamId: params.teamId,
    opponentId: isHome ? params.fixture.away.id : params.fixture.home.id,
    metrics,
    metricProviders,
    coverage: coverageFor(supported, metrics),
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
): NormalizedTeamFixtureStats {
  const side = bsdSideStats(payload, fixture, teamId) ?? {};
  const normalized = normalizeFromRecord({ provider: "BSD", fixture, teamId, record: side });
  const shotmap = bsdShotmapMetrics(payload, fixture, teamId);
  if (shotmap) {
    normalized.metrics.shots = shotmap.shots;
    normalized.metrics.shots_on_target = shotmap.shotsOnTarget;
    normalized.metricProviders.shots = "BSD";
    normalized.metricProviders.shots_on_target = "BSD";
    normalized.coverage = coverageFor(normalized.coverage.supported, normalized.metrics);
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
      const next = readNumberValue(stat.value);
      if (next !== null || !Object.prototype.hasOwnProperty.call(record, type)) {
        record[type] = next;
      }
    }
    return record;
  }
  return null;
}

export function normalizeApiFootballFixtureStats(
  payload: unknown,
  fixture: ProviderFixture,
  teamId: number,
): NormalizedTeamFixtureStats {
  return normalizeFromRecord({
    provider: "API-FOOTBALL",
    fixture,
    teamId,
    record: apiTeamStatistics(payload, teamId) ?? {},
  });
}

export function fixtureStatValue(
  snapshot: NormalizedTeamFixtureStats | null | undefined,
  metric: TeamMetric,
): number | null {
  const value = snapshot?.metrics[metric];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
