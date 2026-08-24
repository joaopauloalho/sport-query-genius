import { AnalysisPipelineError } from "@/server/analysis/errors";
import {
  resolveFootballEntityCandidates,
  type EntityCandidate,
} from "@/server/sports/entity-resolver";
import type {
  GoalEventFixtureResult,
  PlayerFixtureStat,
  PlayerGoalEvent,
  PlayerShotStats,
  PlayerSportsDataProvider,
  ResolvedPlayer,
} from "@/server/sports/player-provider";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
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

function nested(
  record: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> | null {
  for (const key of keys) {
    const found = asRecord(record[key]);
    if (found) return found;
  }
  return null;
}

function extractList(payload: unknown): Record<string, unknown>[] {
  if (Array.isArray(payload)) {
    return payload.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
  }
  const root = asRecord(payload);
  if (!root) return [];
  for (const key of ["results", "players", "items"]) {
    if (Array.isArray(root[key])) {
      return (root[key] as unknown[])
        .map(asRecord)
        .filter((item): item is Record<string, unknown> => item !== null);
    }
  }
  return [];
}

function collectRecords(payload: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 4) return [];
  if (Array.isArray(payload)) {
    return payload.flatMap((value) => {
      const record = asRecord(value);
      return record
        ? [record, ...collectRecords(record, depth + 1)]
        : collectRecords(value, depth + 1);
    });
  }
  const record = asRecord(payload);
  if (!record) return [];
  return Object.values(record).flatMap((value) => collectRecords(value, depth + 1));
}

function readDate(record: Record<string, unknown>): { date: string; timestamp: number } | null {
  const raw = readString(record, [
    "start_time",
    "event_date",
    "kickoff_at",
    "kickoff",
    "date",
    "scheduled_at",
  ]);
  if (raw) {
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return { date: raw, timestamp: Math.floor(ms / 1000) };
  }
  const unix = readNumber(record, ["start_timestamp", "timestamp", "kickoff_timestamp"]);
  if (unix !== null) {
    const ms = unix > 10_000_000_000 ? unix : unix * 1000;
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime()))
      return { date: date.toISOString(), timestamp: Math.floor(ms / 1000) };
  }
  return null;
}

function readTeam(record: Record<string, unknown>, side: "home" | "away") {
  const team = nested(record, [`${side}_team`, side]);
  if (team) {
    const id = readNumber(team, ["id", "team_id"]);
    const name = readString(team, ["name", "team_name", "short_name"]);
    if (name) return { id, name };
  }
  const id = readNumber(record, [`${side}_team_id`, `${side}_id`]);
  const name = readString(record, [`${side}_team_name`, `${side}_name`]);
  return name ? { id, name } : null;
}

function readScore(record: Record<string, unknown>, side: "home" | "away"): number | null {
  const direct = readNumber(record, [`${side}_score`, `${side}_goals`, `score_${side}`]);
  if (direct !== null) return direct;
  const score = nested(record, ["score", "scores"]);
  return score
    ? readNumber(score, [side, `${side}_score`, `${side}_goals`, `full_time_${side}`])
    : null;
}

function readCompetition(record: Record<string, unknown>): string {
  const league = nested(record, ["league", "competition", "tournament"]);
  return (
    (league ? readString(league, ["name", "league_name", "competition_name"]) : null) ??
    readString(record, ["league_name", "competition_name", "tournament_name"]) ??
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

function parseMinute(value: unknown): { minute: number | null; extraTime: number | null } {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { minute: Math.trunc(value), extraTime: null };
  }
  if (typeof value !== "string") return { minute: null, extraTime: null };
  const match = value.trim().match(/^(\d+)(?:\+(\d+))?/);
  return match
    ? { minute: Number(match[1]), extraTime: match[2] ? Number(match[2]) : null }
    : { minute: null, extraTime: null };
}

function playerFromRecord(raw: Record<string, unknown>): ResolvedPlayer | null {
  const playerRecord = nested(raw, ["player"]) ?? raw;
  const id = readNumber(playerRecord, ["id", "player_id"]) ?? readNumber(raw, ["player_id"]);
  const name =
    readString(playerRecord, ["name", "player_name", "short_name"]) ??
    readString(raw, ["player_name"]);
  if (id === null || !name) return null;
  const team =
    nested(raw, ["team", "current_team"]) ?? nested(playerRecord, ["team", "current_team"]);
  return {
    id,
    name,
    teamId: (team ? readNumber(team, ["id", "team_id"]) : null) ?? readNumber(raw, ["team_id"]),
    teamName:
      (team ? readString(team, ["name", "team_name"]) : null) ?? readString(raw, ["team_name"]),
    position:
      readString(playerRecord, ["position", "position_name", "primary_position"]) ??
      readString(raw, ["position", "position_name"]),
    country:
      readString(playerRecord, ["country", "nationality", "country_name"]) ??
      readString(raw, ["country", "nationality", "country_name"]) ??
      "",
  };
}

function looksLikePlayerStat(record: Record<string, unknown>): boolean {
  const event = nested(record, ["event", "fixture", "match"]);
  const fixtureId =
    (event ? readNumber(event, ["id", "event_id", "fixture_id"]) : null) ??
    readNumber(record, ["event_id", "fixture_id", "match_id"]);
  const minutes = readNumber(record, ["minutes", "minutes_played", "mins", "min"]);
  return fixtureId !== null && (minutes !== null || "goals" in record || "rating" in record);
}

function playerStatFromRecord(
  raw: Record<string, unknown>,
  player: ResolvedPlayer,
): PlayerFixtureStat | null {
  const event = nested(raw, ["event", "fixture", "match"]) ?? raw;
  const fixtureId =
    readNumber(event, ["id", "event_id", "fixture_id"]) ??
    readNumber(raw, ["event_id", "fixture_id", "match_id"]);
  const when = readDate(event) ?? readDate(raw);
  if (fixtureId === null || !when) return null;

  const rowTeam = nested(raw, ["team", "club"]);
  const teamId =
    (rowTeam ? readNumber(rowTeam, ["id", "team_id"]) : null) ??
    readNumber(raw, ["team_id"]) ??
    player.teamId;
  const teamName =
    (rowTeam ? readString(rowTeam, ["name", "team_name"]) : null) ??
    readString(raw, ["team_name", "club_name"]) ??
    player.teamName;
  const home = readTeam(event, "home");
  const away = readTeam(event, "away");

  let venue: "home" | "away" | null = null;
  let opponentId: number | null = null;
  let opponentName: string | null = null;
  if (teamId !== null && home?.id === teamId) {
    venue = "home";
    opponentId = away?.id ?? null;
    opponentName = away?.name ?? null;
  } else if (teamId !== null && away?.id === teamId) {
    venue = "away";
    opponentId = home?.id ?? null;
    opponentName = home?.name ?? null;
  }

  const directVenue = readString(raw, ["venue", "home_away"]);
  if (!venue && directVenue) {
    const normalized = directVenue.toLowerCase();
    if (normalized === "home" || normalized === "h" || normalized === "casa") venue = "home";
    if (normalized === "away" || normalized === "a" || normalized === "fora") venue = "away";
  }
  opponentId ??= readNumber(raw, ["opponent_id", "opponent_team_id"]);
  opponentName ??= readString(raw, ["opponent", "opponent_name", "opponent_team_name"]);
  if (!venue || !opponentName) return null;

  const homeGoals = readScore(event, "home");
  const awayGoals = readScore(event, "away");
  const result =
    homeGoals !== null && awayGoals !== null
      ? `${homeGoals}-${awayGoals}`
      : (readString(raw, ["result", "score"]) ?? "");

  const yellow = readNumber(raw, ["yellow_cards", "yellow_card", "cards_yellow"]);
  const red = readNumber(raw, ["red_cards", "red_card", "cards_red"]);
  const directCards = readNumber(raw, ["cards", "total_cards"]);
  const cards =
    directCards ?? (yellow !== null || red !== null ? (yellow ?? 0) + (red ?? 0) : null);

  return {
    fixtureId,
    date: when.date,
    timestamp: when.timestamp,
    competition: readCompetition(event),
    teamId,
    teamName,
    opponentId,
    opponentName,
    venue,
    result,
    minutes: readNumber(raw, ["minutes", "minutes_played", "mins", "min"]),
    goals: readNumber(raw, ["goals", "goals_total"]),
    assists: readNumber(raw, ["assists", "goal_assists"]),
    shots: readNumber(raw, ["shots", "total_shots", "shots_total"]),
    shotsOnTarget: readNumber(raw, ["shots_on_target", "shots_target", "shots_on"]),
    cards,
    shotmapCovered: false,
    source: "BSD",
  };
}

function findShotmap(payload: unknown, depth = 0): Record<string, unknown>[] | null {
  if (depth > 5) return null;
  const record = asRecord(payload);
  if (record) {
    for (const key of ["shotmap", "shots", "shot_map"]) {
      const value = record[key];
      if (Array.isArray(value)) {
        return value.map(asRecord).filter((item): item is Record<string, unknown> => item !== null);
      }
    }
    for (const value of Object.values(record)) {
      const found = findShotmap(value, depth + 1);
      if (found) return found;
    }
  }
  if (Array.isArray(payload)) {
    for (const value of payload) {
      const found = findShotmap(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function shotPlayerId(shot: Record<string, unknown>): number | null {
  const player = nested(shot, ["player"]);
  return (
    readNumber(shot, ["player_id", "playerId"]) ??
    (player ? readNumber(player, ["id", "player_id"]) : null)
  );
}

function shotType(shot: Record<string, unknown>): string {
  return (readString(shot, ["type", "shot_type", "result", "outcome"]) ?? "").toLowerCase();
}

function isShootout(shot: Record<string, unknown>): boolean {
  const situation = (
    readString(shot, ["situation", "incident_type", "period"]) ?? ""
  ).toLowerCase();
  return situation.includes("shootout") || situation.includes("penalty shootout");
}

export class BsdPlayerProvider implements PlayerSportsDataProvider {
  readonly name = "BSD";

  private async request(
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<unknown> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }
    const url = new URL(`${BSD_BASE_URL}${path}`);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Authorization: `Token ${apiKey}` },
        signal: controller.signal,
      });
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não respondeu à consulta de jogador.",
      );
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401)
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A chave da BSD Football API não foi aceita.",
      );
    if (response.status === 429)
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite de requisições da BSD Football API foi atingido.",
      );
    if (!response.ok) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `A BSD Football API falhou ao consultar ${path} (HTTP ${response.status}).`,
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API retornou uma resposta de jogador inválida.",
      );
    }
  }

  async resolvePlayer(name: string): Promise<ResolvedPlayer> {
    const payload = await this.request("/players/", { name, limit: 20 });
    const players = extractList(payload)
      .map(playerFromRecord)
      .filter((player): player is ResolvedPlayer => player !== null);
    const candidates: EntityCandidate[] = players.map((player) => ({
      id: player.id,
      name: player.name,
      country: player.country,
      context: player.teamName ?? player.position ?? undefined,
    }));
    const resolution = resolveFootballEntityCandidates(name, candidates);
    if (resolution.status === "ambiguous") {
      throw new AnalysisPipelineError(
        "ENTITY_AMBIGUOUS",
        `Encontramos mais de um jogador plausível para "${name}". Escolha um nome mais específico.`,
        resolution.candidates.map((candidate) => ({
          id: String(candidate.id),
          name: candidate.name,
          provider: this.name,
          context: candidate.context ?? candidate.country,
        })),
      );
    }
    if (resolution.status !== "resolved") {
      throw new AnalysisPipelineError(
        "PLAYER_NOT_FOUND",
        `Não encontramos o jogador "${name}" na BSD Football API.`,
      );
    }
    const player = players.find((candidate) => candidate.id === resolution.candidate.id);
    if (!player)
      throw new AnalysisPipelineError(
        "PLAYER_NOT_FOUND",
        `Não encontramos o jogador "${name}" na BSD Football API.`,
      );
    return player;
  }

  async getPlayerById(playerId: number): Promise<ResolvedPlayer> {
    const payload = await this.request(`/players/${playerId}/`);
    const root = asRecord(payload);
    const player = root ? playerFromRecord(root) : null;
    if (!player)
      throw new AnalysisPipelineError(
        "PLAYER_NOT_FOUND",
        `O jogador ${playerId} não foi encontrado na BSD Football API.`,
      );
    return player;
  }

  async getRecentPlayerStats(
    player: ResolvedPlayer,
    count: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerFixtureStat[]> {
    const payload = await this.request(`/players/${player.id}/stats/`, {
      limit: Math.min(200, Math.max(30, count * 4)),
    });
    const seen = new Set<number>();
    const stats = collectRecords(payload)
      .filter(looksLikePlayerStat)
      .map((record) => playerStatFromRecord(record, player))
      .filter((stat): stat is PlayerFixtureStat => stat !== null)
      .filter((stat) => {
        if (seen.has(stat.fixtureId)) return false;
        seen.add(stat.fixtureId);
        return competitionAllowed(stat.competition, competitionNames);
      })
      .sort((a, b) => a.timestamp - b.timestamp);

    console.info("[bsd-player] player fixture stats parsed", {
      playerId: player.id,
      requested: count,
      parsed: stats.length,
      latestFixtureIds: stats.slice(-Math.min(count, 10)).map((stat) => stat.fixtureId),
    });
    return stats.slice(-Math.max(count, 1));
  }

  async getFixtureShotStats(fixtureId: number, playerId: number): Promise<PlayerShotStats> {
    const payload = await this.request(`/events/${fixtureId}/stats/`);
    const shotmap = findShotmap(payload);
    if (!shotmap || shotmap.length === 0) {
      return { coverage: false, shots: null, shotsOnTarget: null };
    }
    const playerShots = shotmap.filter(
      (shot) => shotPlayerId(shot) === playerId && !isShootout(shot),
    );
    const shotsOnTarget = playerShots.filter((shot) => {
      const type = shotType(shot);
      return type === "goal" || type === "save" || type === "saved" || type === "on target";
    }).length;
    return { coverage: true, shots: playerShots.length, shotsOnTarget };
  }

  async getGoalEventsForFixture(
    fixture: PlayerFixtureStat,
    playerId: number,
  ): Promise<GoalEventFixtureResult> {
    const payload = await this.request(`/events/${fixture.fixtureId}/stats/`);
    const shotmap = findShotmap(payload);
    if (!shotmap || shotmap.length === 0) return { coverage: false, events: [] };

    const events: PlayerGoalEvent[] = [];
    for (const [index, shot] of shotmap.entries()) {
      if (shotPlayerId(shot) !== playerId || isShootout(shot) || shotType(shot) !== "goal")
        continue;
      const parsedMinute = parseMinute(shot.min ?? shot.minute ?? shot.time);
      const minute = parsedMinute.minute;
      const extraTime = parsedMinute.extraTime ?? readNumber(shot, ["extra_time", "added_time"]);
      events.push({
        eventKey: `${fixture.fixtureId}:goal:${playerId}:${minute ?? "unknown"}:${extraTime ?? 0}:${index}`,
        fixtureId: fixture.fixtureId,
        date: fixture.date,
        timestamp: fixture.timestamp,
        competition: fixture.competition,
        teamId: fixture.teamId,
        teamName: fixture.teamName,
        opponentId: fixture.opponentId,
        opponentName: fixture.opponentName,
        venue: fixture.venue,
        result: fixture.result,
        minute,
        extraTime,
        situation: readString(shot, ["situation", "shot_situation"]),
        bodyPart: readString(shot, ["body_part", "bodyPart"]),
        xg: readNumber(shot, ["xg", "expected_goals"]),
        xgEstimated:
          typeof shot.xg_estimated === "boolean"
            ? shot.xg_estimated
            : typeof shot.xgEstimated === "boolean"
              ? shot.xgEstimated
              : null,
        source: "BSD",
      });
    }
    return { coverage: true, events };
  }
}
