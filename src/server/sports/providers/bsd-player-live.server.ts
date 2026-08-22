import { AnalysisPipelineError } from "@/server/analysis/errors";
import type {
  PlayerFixtureStat,
  ResolvedPlayer,
} from "@/server/sports/player-provider";

import { BsdPlayerProvider as BaseBsdPlayerProvider } from "./bsd-player.server";

const BSD_V2_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const BSD_V1_BASE_URL = "https://sports.bzzoiro.com/api";
const TIMEOUT_MS = 15_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function readString(record: Record<string, unknown> | null, keys: readonly string[]): string | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace("%", ""));
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function nested(record: Record<string, unknown> | null, keys: readonly string[]): Record<string, unknown> | null {
  if (!record) return null;
  for (const key of keys) {
    const value = asRecord(record[key]);
    if (value) return value;
  }
  return null;
}

function scalarNumber(record: Record<string, unknown> | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  }
  return null;
}

function extractList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map(asRecord).filter((row): row is Record<string, unknown> => row !== null);
  }
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["results", "stats", "items", "matches", "player_stats"]) {
    if (Array.isArray(root[key])) {
      return (root[key] as unknown[])
        .map(asRecord)
        .filter((row): row is Record<string, unknown> => row !== null);
    }
  }
  return [];
}

function fixtureIdOf(raw: Record<string, unknown>): number | null {
  const event = nested(raw, ["event", "fixture", "match", "match_info"]);
  return (
    readNumber(event, ["id", "event_id", "fixture_id", "match_id"]) ??
    readNumber(raw, ["event_id", "fixture_id", "match_id"]) ??
    scalarNumber(raw, ["event", "fixture", "match"])
  );
}

function readDate(raw: Record<string, unknown>): { date: string; timestamp: number } | null {
  const event = nested(raw, ["event", "fixture", "match", "match_info"]);
  for (const record of [event, raw]) {
    const value = readString(record, [
      "start_time",
      "event_date",
      "kickoff_at",
      "kickoff",
      "date",
      "scheduled_at",
      "event_start_time",
      "start_date",
    ]);
    if (value) {
      const milliseconds = Date.parse(value);
      if (Number.isFinite(milliseconds)) {
        return { date: value, timestamp: Math.floor(milliseconds / 1000) };
      }
    }
    const unix = readNumber(record, [
      "start_timestamp",
      "event_timestamp",
      "timestamp",
      "kickoff_timestamp",
    ]);
    if (unix !== null) {
      const milliseconds = unix > 10_000_000_000 ? unix : unix * 1000;
      const date = new Date(milliseconds);
      if (!Number.isNaN(date.getTime())) {
        return { date: date.toISOString(), timestamp: Math.floor(milliseconds / 1000) };
      }
    }
  }
  return null;
}

function readTeam(record: Record<string, unknown>, side: "home" | "away") {
  const team = nested(record, [`${side}_team`, side]);
  const id =
    readNumber(team, ["id", "team_id"]) ??
    readNumber(record, [`${side}_team_id`, `${side}_id`]);
  const name =
    readString(team, ["name", "team_name", "short_name"]) ??
    readString(record, [`${side}_team_name`, `${side}_name`]);
  return name ? { id, name } : null;
}

function readScore(record: Record<string, unknown>, side: "home" | "away"): number | null {
  const direct = readNumber(record, [`${side}_score`, `${side}_goals`, `score_${side}`]);
  if (direct !== null) return direct;
  const score = nested(record, ["score", "scores"]);
  return readNumber(score, [side, `${side}_score`, `${side}_goals`, `full_time_${side}`]);
}

function readCompetition(raw: Record<string, unknown>): string {
  const event = nested(raw, ["event", "fixture", "match", "match_info"]) ?? raw;
  const league = nested(event, ["league", "competition", "tournament"]);
  return (
    readString(league, ["name", "league_name", "competition_name"]) ??
    readString(event, ["league_name", "competition_name", "tournament_name"]) ??
    readString(raw, ["league_name", "competition_name", "tournament_name"]) ??
    (typeof raw.competition === "string" ? raw.competition : null) ??
    (typeof raw.league === "string" ? raw.league : null) ??
    "Competição"
  );
}

function normalizeCompetition(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function competitionAllowed(value: string, names?: readonly string[] | null): boolean {
  if (!names || names.length === 0) return true;
  const normalized = normalizeCompetition(value);
  return names.some((name) => normalizeCompetition(name) === normalized);
}

function metricRecord(raw: Record<string, unknown>): Record<string, unknown> {
  return nested(raw, ["statistics", "stats", "player_stats"]) ?? raw;
}

function readMetric(
  raw: Record<string, unknown>,
  directKeys: readonly string[],
  groups: readonly { group: string; keys: readonly string[] }[] = [],
): number | null {
  const metrics = metricRecord(raw);
  const direct = readNumber(metrics, directKeys) ?? (metrics !== raw ? readNumber(raw, directKeys) : null);
  if (direct !== null) return direct;
  for (const { group, keys } of groups) {
    const grouped = nested(metrics, [group]) ?? (metrics !== raw ? nested(raw, [group]) : null);
    const value = readNumber(grouped, keys);
    if (value !== null) return value;
  }
  return null;
}

function parseRow(raw: Record<string, unknown>, player: ResolvedPlayer): PlayerFixtureStat | null {
  const fixtureId = fixtureIdOf(raw);
  const when = readDate(raw);
  if (fixtureId === null || !when) return null;

  const event = nested(raw, ["event", "fixture", "match", "match_info"]) ?? raw;
  const rowTeam = nested(raw, ["team", "club"]);
  const teamId =
    readNumber(rowTeam, ["id", "team_id"]) ??
    readNumber(raw, ["team_id", "club_id"]) ??
    scalarNumber(raw, ["team", "club"]) ??
    player.teamId;
  const teamName =
    readString(rowTeam, ["name", "team_name"]) ??
    readString(raw, ["team_name", "club_name"]) ??
    player.teamName;

  const home = readTeam(event, "home") ?? readTeam(raw, "home");
  const away = readTeam(event, "away") ?? readTeam(raw, "away");
  const opponentRecord = nested(raw, ["opponent", "opponent_team"]);

  let venue: "home" | "away" | null = null;
  let opponentId: number | null = readNumber(opponentRecord, ["id", "team_id"]);
  let opponentName: string | null = readString(opponentRecord, ["name", "team_name"]);

  if (teamId !== null && home?.id === teamId) {
    venue = "home";
    opponentId ??= away?.id ?? null;
    opponentName ??= away?.name ?? null;
  } else if (teamId !== null && away?.id === teamId) {
    venue = "away";
    opponentId ??= home?.id ?? null;
    opponentName ??= home?.name ?? null;
  }

  const directVenue = readString(raw, ["venue", "home_away", "home_or_away"]);
  if (!venue && directVenue) {
    const normalized = directVenue.toLowerCase();
    if (["home", "h", "casa"].includes(normalized)) venue = "home";
    if (["away", "a", "fora"].includes(normalized)) venue = "away";
  }
  if (!venue && typeof raw.is_home === "boolean") venue = raw.is_home ? "home" : "away";
  if (!venue && typeof raw.home === "boolean") venue = raw.home ? "home" : "away";

  opponentId ??= readNumber(raw, ["opponent_id", "opponent_team_id"]);
  opponentName ??= readString(raw, ["opponent_name", "opponent_team_name"]);
  if (!opponentName && venue === "home") {
    opponentId ??= away?.id ?? null;
    opponentName = away?.name ?? null;
  }
  if (!opponentName && venue === "away") {
    opponentId ??= home?.id ?? null;
    opponentName = home?.name ?? null;
  }
  if (!venue || !opponentName) return null;

  const homeGoals = readScore(event, "home") ?? readScore(raw, "home");
  const awayGoals = readScore(event, "away") ?? readScore(raw, "away");
  const result =
    homeGoals !== null && awayGoals !== null
      ? `${homeGoals}-${awayGoals}`
      : readString(raw, ["result", "scoreline", "final_score"]) ?? "";

  const minutes = readMetric(raw, ["minutes", "minutes_played", "mins", "min"], [
    { group: "games", keys: ["minutes", "minutes_played"] },
  ]);
  const goals = readMetric(raw, ["goals", "goals_total"], [
    { group: "goals", keys: ["total", "goals"] },
  ]);
  const assists = readMetric(raw, ["assists", "goal_assists"], [
    { group: "goals", keys: ["assists"] },
  ]);
  const shots = readMetric(raw, ["shots", "total_shots", "shots_total"], [
    { group: "shots", keys: ["total", "shots", "attempts"] },
  ]);
  const shotsOnTarget = readMetric(raw, ["shots_on_target", "shots_target", "shots_on"], [
    { group: "shots", keys: ["on", "on_target", "target", "shots_on_target"] },
  ]);
  const yellow = readMetric(raw, ["yellow_cards", "yellow_card", "cards_yellow"], [
    { group: "cards", keys: ["yellow", "yellow_cards"] },
  ]);
  const red = readMetric(raw, ["red_cards", "red_card", "cards_red"], [
    { group: "cards", keys: ["red", "red_cards"] },
  ]);
  const directCards = readMetric(raw, ["cards", "total_cards"]);
  const cards = directCards ?? (yellow !== null || red !== null ? (yellow ?? 0) + (red ?? 0) : null);

  if (minutes === null && goals === null && assists === null && shots === null && shotsOnTarget === null) {
    return null;
  }

  return {
    fixtureId,
    date: when.date,
    timestamp: when.timestamp,
    competition: readCompetition(raw),
    teamId,
    teamName,
    opponentId,
    opponentName,
    venue,
    result,
    minutes,
    goals,
    assists,
    shots,
    shotsOnTarget,
    cards,
    shotmapCovered: false,
    source: "BSD",
  };
}

function shapeSummary(payload: unknown) {
  const root = asRecord(payload);
  const rows = extractList(payload);
  const first = rows[0];
  const nestedKeys = first
    ? Object.fromEntries(
        Object.entries(first)
          .filter(([, value]) => asRecord(value) !== null)
          .slice(0, 12)
          .map(([key, value]) => [key, Object.keys(asRecord(value)!).slice(0, 30)]),
      )
    : {};
  return {
    rootKeys: root ? Object.keys(root).slice(0, 30) : [],
    rowCount: rows.length,
    firstRowKeys: first ? Object.keys(first).slice(0, 50) : [],
    firstNestedKeys: nestedKeys,
  };
}

export class BsdPlayerProvider extends BaseBsdPlayerProvider {
  private async requestJson(
    baseUrl: string,
    path: string,
    params: Record<string, string | number>,
  ): Promise<unknown> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }
    const url = new URL(`${baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
      if (response.status === 401) {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          "A chave da BSD Football API não foi aceita.",
        );
      }
      if (response.status === 429) {
        throw new AnalysisPipelineError(
          "API_LIMIT_REACHED",
          "O limite de requisições da BSD Football API foi atingido.",
        );
      }
      if (!response.ok) {
        throw new AnalysisPipelineError(
          "PROVIDER_UNAVAILABLE",
          `A BSD Football API falhou ao consultar ${path} (HTTP ${response.status}).`,
        );
      }
      return (await response.json()) as unknown;
    } catch (error) {
      if (error instanceof AnalysisPipelineError) throw error;
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não respondeu à consulta de estatísticas por partida.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseStats(
    payload: unknown,
    player: ResolvedPlayer,
    competitionNames?: readonly string[] | null,
  ): PlayerFixtureStat[] {
    const seen = new Set<number>();
    return extractList(payload)
      .map((row) => parseRow(row, player))
      .filter((row): row is PlayerFixtureStat => row !== null)
      .filter((row) => {
        if (seen.has(row.fixtureId)) return false;
        seen.add(row.fixtureId);
        return competitionAllowed(row.competition, competitionNames);
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  override async getRecentPlayerStats(
    player: ResolvedPlayer,
    count: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerFixtureStat[]> {
    const v2Payload = await this.requestJson(
      BSD_V2_BASE_URL,
      `/players/${player.id}/stats/`,
      { limit: Math.min(200, Math.max(30, count * 4)), offset: 0 },
    );
    let stats = this.parseStats(v2Payload, player, competitionNames);
    let source = "v2";

    if (stats.length === 0) {
      console.warn("[bsd-player] v2 player-stat shape produced no usable rows", {
        playerId: player.id,
        ...shapeSummary(v2Payload),
      });

      const legacyFirst = await this.requestJson(BSD_V1_BASE_URL, "/player-stats/", {
        player: player.id,
        page: 1,
      });
      const legacyRows = extractList(legacyFirst);
      let combinedRows = legacyRows;
      const root = asRecord(legacyFirst);
      const total = readNumber(root, ["count"]);
      if ((total !== null && total > legacyRows.length) || legacyRows.length >= 50) {
        const legacySecond = await this.requestJson(BSD_V1_BASE_URL, "/player-stats/", {
          player: player.id,
          page: 2,
        });
        combinedRows = [...legacyRows, ...extractList(legacySecond)];
      }
      stats = this.parseStats({ results: combinedRows }, player, competitionNames);
      source = "v1-fallback";
    }

    console.info("[bsd-player] player fixture stats parsed", {
      playerId: player.id,
      requested: count,
      parsed: stats.length,
      source,
      latestFixtureIds: stats.slice(-Math.min(count, 10)).map((row) => row.fixtureId),
    });
    return stats.slice(-Math.max(count, 1));
  }
}
