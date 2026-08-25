import type { ProviderFixture } from "./provider";
import {
  getFootballMetricDefinition,
  PLAYER_METRIC_KEYS,
  type MetricProvider,
  type PlayerMetricKey,
} from "./metric-catalog";

export interface NormalizedPlayerMatchStatValue {
  value: number | null;
  observed: boolean;
  source: "BSD" | "API-FOOTBALL";
  unit: string;
  rawLabel: string | null;
}

export interface NormalizedPlayerMatchStats {
  fixtureId: number;
  playerId: number;
  teamId: number;
  opponentId: number;
  competitionId?: string | null;
  competitionName: string;
  seasonId?: string | null;
  seasonLabel?: string | null;
  date: string;
  timestamp: number;
  venue: "home" | "away";
  result: string;
  outcome: "win" | "draw" | "loss" | null;
  participated: boolean;
  started: boolean | null;
  substitute: boolean | null;
  metrics: Partial<Record<PlayerMetricKey, NormalizedPlayerMatchStatValue>>;
  coverage: {
    supported: PlayerMetricKey[];
    observed: PlayerMetricKey[];
    missing: PlayerMetricKey[];
  };
  provenance: {
    provider: "BSD" | "API-FOOTBALL";
    rawLabels: string[];
    fetchedAt: string;
    endpoint: string;
    dataFamily: "player_match_stats";
  };
}

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

function pathValue(record: JsonRecord, path: string): unknown {
  let cursor: unknown = record;
  for (const part of path.split(".")) {
    const current = asRecord(cursor);
    if (!current || !Object.prototype.hasOwnProperty.call(current, part)) return undefined;
    cursor = current[part];
  }
  return cursor;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function readFirstNumber(
  record: JsonRecord,
  paths: readonly string[],
): { value: number | null; observed: boolean; rawLabel: string | null } {
  for (const path of paths) {
    const raw = pathValue(record, path);
    if (raw === undefined || raw === null || raw === "") continue;
    const value = numeric(raw);
    if (value !== null) return { value, observed: true, rawLabel: path };
  }
  return { value: null, observed: false, rawLabel: null };
}

function readBoolean(record: JsonRecord, paths: readonly string[]): boolean | null {
  for (const path of paths) {
    const value = pathValue(record, path);
    if (typeof value === "boolean") return value;
    if (value === 1 || value === "1" || value === "true") return true;
    if (value === 0 || value === "0" || value === "false") return false;
  }
  return null;
}

const BSD_PATHS: Partial<Record<PlayerMetricKey, readonly string[]>> = {
  minutes: ["minutes", "minutes_played", "mins", "min", "games.minutes"],
  goals: ["goals", "goals_total", "goals.total"],
  assists: ["assists", "goal_assist", "goal_assists", "goals.assists"],
  shots: ["shots", "total_shots", "shots_total", "shots.total"],
  shots_on_target: ["shots_on_target", "shots_target", "shots_on", "shots.on"],
  shots_off_target: ["shots_off_target", "shots.off"],
  blocked_shots: ["blocked_shots", "shots.blocked"],
  rating: ["rating", "games.rating"],
  passes: ["passes", "total_passes", "passes.total"],
  accurate_passes: ["accurate_passes", "passes.accurate"],
  pass_accuracy: ["pass_accuracy", "passes.accuracy"],
  key_passes: ["key_passes", "passes.key"],
  crosses: ["crosses"],
  accurate_crosses: ["accurate_crosses"],
  long_balls: ["long_balls"],
  accurate_long_balls: ["accurate_long_balls"],
  duels: ["duels", "duels.total"],
  duels_won: ["duels_won", "duels.won"],
  ground_duels: ["ground_duels"],
  ground_duels_won: ["ground_duels_won"],
  aerial_duels: ["aerial_duels"],
  aerial_duels_won: ["aerial_duels_won"],
  dribbles: ["dribbles", "dribbles.attempts"],
  successful_dribbles: ["successful_dribbles", "dribbles.success"],
  dispossessed: ["dispossessed"],
  tackles: ["tackles", "tackles.total"],
  tackles_won: ["tackles_won"],
  interceptions: ["interceptions", "tackles.interceptions"],
  clearances: ["clearances"],
  recoveries: ["recoveries"],
  fouls: ["fouls", "fouls_committed", "fouls.committed"],
  fouls_drawn: ["fouls_drawn", "was_fouled", "fouls.drawn"],
  yellow_cards: ["yellow_cards", "yellow_card", "cards_yellow", "cards.yellow"],
  red_cards: ["red_cards", "red_card", "cards_red", "cards.red"],
  cards: ["cards", "total_cards"],
  xg: ["xg", "expected_goals", "expectedGoals"],
  xgot: ["xgot", "expected_goals_on_target"],
  big_chances: ["big_chances"],
  big_chances_scored: ["big_chances_scored"],
  big_chances_missed: ["big_chances_missed"],
  saves: ["saves", "goalkeeper_saves", "goals.saves"],
  big_saves: ["big_saves"],
  goals_prevented: ["goals_prevented"],
};

const API_PATHS: Partial<Record<PlayerMetricKey, readonly string[]>> = {
  minutes: ["games.minutes"],
  goals: ["goals.total"],
  assists: ["goals.assists"],
  shots: ["shots.total"],
  shots_on_target: ["shots.on"],
  rating: ["games.rating"],
  passes: ["passes.total"],
  pass_accuracy: ["passes.accuracy"],
  key_passes: ["passes.key"],
  duels: ["duels.total"],
  duels_won: ["duels.won"],
  dribbles: ["dribbles.attempts"],
  successful_dribbles: ["dribbles.success"],
  tackles: ["tackles.total"],
  interceptions: ["tackles.interceptions"],
  fouls: ["fouls.committed"],
  fouls_drawn: ["fouls.drawn"],
  yellow_cards: ["cards.yellow"],
  red_cards: ["cards.red"],
  saves: ["goals.saves"],
};

function sourceName(provider: MetricProvider): "BSD" | "API-FOOTBALL" {
  return provider === "API_FOOTBALL" ? "API-FOOTBALL" : "BSD";
}

function observedValue(
  provider: MetricProvider,
  metric: PlayerMetricKey,
  record: JsonRecord,
): NormalizedPlayerMatchStatValue {
  const paths = provider === "BSD" ? BSD_PATHS[metric] ?? [] : API_PATHS[metric] ?? [];
  const read = readFirstNumber(record, paths);
  return {
    value: read.value,
    observed: read.observed,
    source: sourceName(provider),
    unit: getFootballMetricDefinition(metric, "player")?.unit ?? "count",
    rawLabel: read.rawLabel,
  };
}

function unknownValue(
  provider: MetricProvider,
  metric: PlayerMetricKey,
): NormalizedPlayerMatchStatValue {
  return {
    value: null,
    observed: false,
    source: sourceName(provider),
    unit: getFootballMetricDefinition(metric, "player")?.unit ?? "count",
    rawLabel: null,
  };
}

export function playerMatchStatValue(
  snapshot: NormalizedPlayerMatchStats,
  metric: PlayerMetricKey,
): NormalizedPlayerMatchStatValue {
  const direct = snapshot.metrics[metric];
  if (metric === "goal_contributions") {
    const goals = playerMatchStatValue(snapshot, "goals");
    const assists = playerMatchStatValue(snapshot, "assists");
    if (!goals.observed || !assists.observed || goals.value === null || assists.value === null) {
      return unknownValue(snapshot.provenance.provider === "BSD" ? "BSD" : "API_FOOTBALL", metric);
    }
    return {
      value: goals.value + assists.value,
      observed: true,
      source: snapshot.provenance.provider,
      unit: "count",
      rawLabel: `${goals.rawLabel ?? "goals"}+${assists.rawLabel ?? "assists"}`,
    };
  }
  if (metric === "cards" && (!direct || !direct.observed)) {
    const yellow = playerMatchStatValue(snapshot, "yellow_cards");
    const red = playerMatchStatValue(snapshot, "red_cards");
    if (!yellow.observed || !red.observed || yellow.value === null || red.value === null) {
      return unknownValue(snapshot.provenance.provider === "BSD" ? "BSD" : "API_FOOTBALL", metric);
    }
    return {
      value: yellow.value + red.value,
      observed: true,
      source: snapshot.provenance.provider,
      unit: "count",
      rawLabel: `${yellow.rawLabel ?? "yellow_cards"}+${red.rawLabel ?? "red_cards"}`,
    };
  }
  return direct ?? unknownValue(snapshot.provenance.provider === "BSD" ? "BSD" : "API_FOOTBALL", metric);
}

function calculateOutcome(fixture: ProviderFixture, teamId: number): "win" | "draw" | "loss" | null {
  const isHome = fixture.home.id === teamId;
  const own = isHome ? fixture.goals.home : fixture.goals.away;
  const other = isHome ? fixture.goals.away : fixture.goals.home;
  if (own === null || other === null) return null;
  return own > other ? "win" : own < other ? "loss" : "draw";
}

function isParticipated(metrics: Partial<Record<PlayerMetricKey, NormalizedPlayerMatchStatValue>>): boolean {
  const minutes = metrics.minutes;
  if (minutes?.observed && minutes.value !== null && minutes.value > 0) return true;
  const evidence: PlayerMetricKey[] = [
    "goals",
    "assists",
    "shots",
    "shots_on_target",
    "rating",
    "passes",
    "tackles",
    "interceptions",
    "yellow_cards",
    "red_cards",
    "saves",
    "xg",
  ];
  return evidence.some((metric) => {
    const value = metrics[metric];
    return value?.observed === true && value.value !== null && value.value > 0;
  });
}

function buildSnapshot(params: {
  provider: MetricProvider;
  record: JsonRecord;
  fixture: ProviderFixture;
  playerId: number;
  teamId: number;
  fetchedAt: string;
  endpoint: string;
  started?: boolean | null;
  substitute?: boolean | null;
}): NormalizedPlayerMatchStats | null {
  const { fixture, teamId } = params;
  const isHome = fixture.home.id === teamId;
  const isAway = fixture.away.id === teamId;
  if (!isHome && !isAway) return null;

  const supported = PLAYER_METRIC_KEYS.filter((metric) => {
    const definition = getFootballMetricDefinition(metric, "player");
    return Boolean(definition?.providers[params.provider]);
  });
  const metrics: Partial<Record<PlayerMetricKey, NormalizedPlayerMatchStatValue>> = {};
  for (const metric of supported) {
    if (metric === "goal_contributions") continue;
    metrics[metric] = observedValue(params.provider, metric, params.record);
  }

  const directCards = metrics.cards;
  if (!directCards?.observed) {
    const yellow = metrics.yellow_cards;
    const red = metrics.red_cards;
    if (yellow?.observed && red?.observed && yellow.value !== null && red.value !== null) {
      metrics.cards = {
        value: yellow.value + red.value,
        observed: true,
        source: sourceName(params.provider),
        unit: "count",
        rawLabel: `${yellow.rawLabel ?? "yellow_cards"}+${red.rawLabel ?? "red_cards"}`,
      };
    }
  }
  const goals = metrics.goals;
  const assists = metrics.assists;
  if (goals?.observed && assists?.observed && goals.value !== null && assists.value !== null) {
    metrics.goal_contributions = {
      value: goals.value + assists.value,
      observed: true,
      source: sourceName(params.provider),
      unit: "count",
      rawLabel: `${goals.rawLabel ?? "goals"}+${assists.rawLabel ?? "assists"}`,
    };
  }

  const observed = supported.filter((metric) => playerMatchStatValue({ metrics } as NormalizedPlayerMatchStats, metric).observed);
  const missing = supported.filter((metric) => !observed.includes(metric));
  const rawLabels = observed
    .map((metric) => metrics[metric]?.rawLabel)
    .filter((value): value is string => Boolean(value));
  const opponent = isHome ? fixture.away : fixture.home;
  const own = isHome ? fixture.home : fixture.away;
  const participated = isParticipated(metrics);

  return {
    fixtureId: fixture.id,
    playerId: params.playerId,
    teamId,
    opponentId: opponent.id,
    competitionId: fixture.competitionId ?? null,
    competitionName: fixture.competition,
    seasonId: fixture.seasonId ?? null,
    seasonLabel: fixture.seasonLabel ?? null,
    date: fixture.date,
    timestamp: fixture.timestamp,
    venue: isHome ? "home" : "away",
    result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
    outcome: calculateOutcome(fixture, own.id),
    participated,
    started: participated ? (params.started ?? null) : false,
    substitute: participated ? (params.substitute ?? null) : false,
    metrics,
    coverage: { supported: [...supported], observed, missing },
    provenance: {
      provider: sourceName(params.provider),
      rawLabels: [...new Set(rawLabels)],
      fetchedAt: params.fetchedAt,
      endpoint: params.endpoint,
      dataFamily: "player_match_stats",
    },
  };
}

function fixtureIdFromBsdRow(row: JsonRecord): number | null {
  const direct = readFirstNumber(row, ["event_id", "fixture_id", "match_id"]);
  if (direct.observed) return direct.value;
  return readFirstNumber(row, ["event.id", "fixture.id", "match.id"]).value;
}

function teamIdFromBsdRow(row: JsonRecord): number | null {
  return readFirstNumber(row, ["team_id", "club_id", "team.id", "club.id"]).value;
}

export function normalizeBsdPlayerMatchRows(params: {
  rows: readonly JsonRecord[];
  fixtures: readonly ProviderFixture[];
  playerId: number;
  fallbackTeamId?: number | null;
  fetchedAt?: string;
}): NormalizedPlayerMatchStats[] {
  const fixtures = new Map(params.fixtures.map((fixture) => [fixture.id, fixture]));
  const byFixture = new Map<number, NormalizedPlayerMatchStats>();
  const fetchedAt = params.fetchedAt ?? new Date().toISOString();
  for (const row of params.rows) {
    const fixtureId = fixtureIdFromBsdRow(row);
    const teamId = teamIdFromBsdRow(row) ?? params.fallbackTeamId ?? null;
    if (fixtureId === null || teamId === null) continue;
    const fixture = fixtures.get(fixtureId);
    if (!fixture) continue;
    const snapshot = buildSnapshot({
      provider: "BSD",
      record: asRecord(row.statistics) ?? asRecord(row.stats) ?? row,
      fixture,
      playerId: params.playerId,
      teamId,
      fetchedAt,
      endpoint: "/players/{player_id}/stats/",
    });
    if (snapshot) byFixture.set(snapshot.fixtureId, snapshot);
  }
  return [...byFixture.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export function normalizeApiFootballFixturePlayers(params: {
  payload: unknown;
  fixture: ProviderFixture;
  fetchedAt?: string;
}): NormalizedPlayerMatchStats[] {
  const root = asRecord(params.payload);
  const response = root && Array.isArray(root.response) ? root.response : [];
  const fetchedAt = params.fetchedAt ?? new Date().toISOString();
  const snapshots: NormalizedPlayerMatchStats[] = [];
  for (const rawTeam of response) {
    const teamBlock = asRecord(rawTeam);
    const team = teamBlock ? asRecord(teamBlock.team) : null;
    const teamId = team ? readFirstNumber(team, ["id"]).value : null;
    if (teamId === null || !Array.isArray(teamBlock?.players)) continue;
    for (const rawPlayer of teamBlock.players) {
      const playerBlock = asRecord(rawPlayer);
      const player = playerBlock ? asRecord(playerBlock.player) : null;
      const playerId = player ? readFirstNumber(player, ["id"]).value : null;
      const statistics = playerBlock && Array.isArray(playerBlock.statistics) ? playerBlock.statistics : [];
      const stat = asRecord(statistics[0]);
      if (playerId === null || !stat) continue;
      const substitute = readBoolean(stat, ["games.substitute"]);
      const snapshot = buildSnapshot({
        provider: "API_FOOTBALL",
        record: stat,
        fixture: params.fixture,
        playerId,
        teamId,
        fetchedAt,
        endpoint: "/fixtures/players",
        substitute,
        started: substitute === null ? null : !substitute,
      });
      if (snapshot) snapshots.push(snapshot);
    }
  }
  return snapshots.sort((a, b) => a.playerId - b.playerId);
}

export function extractBsdPlayerStatRows(payload: unknown): JsonRecord[] {
  if (Array.isArray(payload)) return payload.map(asRecord).filter((row): row is JsonRecord => row !== null);
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["results", "stats", "items", "matches", "player_stats"]) {
    if (!Array.isArray(root[key])) continue;
    return (root[key] as unknown[]).map(asRecord).filter((row): row is JsonRecord => row !== null);
  }
  return [];
}

export function bsdPlayerStatTeamIds(payload: unknown, fallback?: number | null): number[] {
  const ids = new Set<number>();
  if (fallback !== null && fallback !== undefined) ids.add(fallback);
  for (const row of extractBsdPlayerStatRows(payload)) {
    const id = teamIdFromBsdRow(row);
    if (id !== null) ids.add(id);
  }
  return [...ids];
}
