import { AnalysisPipelineError } from "@/server/analysis/errors";
import type { ProviderFixture } from "@/server/sports/provider";
import type {
  PlayerFixtureStat,
  ResolvedPlayer,
} from "@/server/sports/player-provider";

import { BsdFootballV3Provider } from "./bsd-football-v3.server";
import { BsdPlayerProvider as BaseBsdPlayerProvider } from "./bsd-player.server";

const BSD_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const TIMEOUT_MS = 15_000;
const STATS_PAGE_SIZE = 200;
const MAX_STATS_PAGES = 3;
const MAX_RECENT_TEAMS = 4;
const TEAM_FIXTURE_HISTORY = 200;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function readNumber(
  record: Record<string, unknown> | null,
  keys: readonly string[],
): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.replace("%", "").trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function extractRows(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  if (!root || !Array.isArray(root.results)) return [];
  return root.results
    .map(asRecord)
    .filter((row): row is Record<string, unknown> => row !== null);
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

function competitionAllowed(
  value: string,
  names?: readonly string[] | null,
): boolean {
  if (!names || names.length === 0) return true;
  const normalized = normalizeCompetition(value);
  return names.some((name) => normalizeCompetition(name) === normalized);
}

function rawTeamId(row: Record<string, unknown>): number | null {
  return readNumber(row, ["team_id", "club_id"]);
}

function rawFixtureId(row: Record<string, unknown>): number | null {
  return readNumber(row, ["event_id", "fixture_id", "match_id"]);
}

function hydratePlayerStat(
  row: Record<string, unknown>,
  fixture: ProviderFixture,
  player: ResolvedPlayer,
): PlayerFixtureStat | null {
  const fixtureId = rawFixtureId(row);
  const teamId = rawTeamId(row) ?? player.teamId;
  if (fixtureId === null || fixture.id !== fixtureId || teamId === null) return null;

  const isHome = fixture.home.id === teamId;
  const isAway = fixture.away.id === teamId;
  if (!isHome && !isAway) return null;

  const minutes = readNumber(row, ["minutes_played", "minutes", "mins", "min"]);
  const goals = readNumber(row, ["goals", "goals_total"]);
  const assists = readNumber(row, ["goal_assist", "goal_assists", "assists"]);
  const shots = readNumber(row, ["total_shots", "shots_total", "shots"]);
  const shotsOnTarget = readNumber(row, [
    "shots_on_target",
    "shots_target",
    "shots_on",
  ]);
  const yellow = readNumber(row, ["yellow_card", "yellow_cards", "cards_yellow"]);
  const red = readNumber(row, ["red_card", "red_cards", "cards_red"]);
  const directCards = readNumber(row, ["cards", "total_cards"]);
  const cards =
    directCards ??
    (yellow !== null || red !== null ? (yellow ?? 0) + (red ?? 0) : null);

  if (
    minutes === null &&
    goals === null &&
    assists === null &&
    shots === null &&
    shotsOnTarget === null
  ) {
    return null;
  }

  const opponent = isHome ? fixture.away : fixture.home;
  const ownTeam = isHome ? fixture.home : fixture.away;

  return {
    fixtureId,
    date: fixture.date,
    timestamp: fixture.timestamp,
    competition: fixture.competition,
    teamId,
    teamName: ownTeam.name || player.teamName,
    opponentId: opponent.id,
    opponentName: opponent.name,
    venue: isHome ? "home" : "away",
    result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
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

export function hydrateBsdPlayerStatRows(params: {
  rows: readonly Record<string, unknown>[];
  fixtures: readonly ProviderFixture[];
  player: ResolvedPlayer;
  competitionNames?: readonly string[] | null;
}): PlayerFixtureStat[] {
  const fixturesById = new Map(params.fixtures.map((fixture) => [fixture.id, fixture]));
  const byFixture = new Map<number, PlayerFixtureStat>();

  for (const row of params.rows) {
    const fixtureId = rawFixtureId(row);
    if (fixtureId === null) continue;
    const fixture = fixturesById.get(fixtureId);
    if (!fixture) continue;
    const hydrated = hydratePlayerStat(row, fixture, params.player);
    if (!hydrated || !competitionAllowed(hydrated.competition, params.competitionNames)) {
      continue;
    }
    byFixture.set(hydrated.fixtureId, hydrated);
  }

  return [...byFixture.values()].sort((a, b) => a.timestamp - b.timestamp);
}

export class BsdPlayerProvider extends BaseBsdPlayerProvider {
  private readonly football = new BsdFootballV3Provider();

  private async requestStatsPage(playerId: number, offset: number): Promise<unknown> {
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }

    const url = new URL(`${BSD_BASE_URL}/players/${playerId}/stats/`);
    url.searchParams.set("limit", String(STATS_PAGE_SIZE));
    url.searchParams.set("offset", String(offset));

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
          `A BSD Football API falhou ao consultar estatísticas por partida (HTTP ${response.status}).`,
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

  private async loadRawStats(playerId: number): Promise<Record<string, unknown>[]> {
    const rows: Record<string, unknown>[] = [];
    for (let page = 0; page < MAX_STATS_PAGES; page += 1) {
      const payload = await this.requestStatsPage(playerId, page * STATS_PAGE_SIZE);
      const pageRows = extractRows(payload);
      rows.push(...pageRows);
      const root = asRecord(payload);
      const total = readNumber(root, ["count"]);
      if (pageRows.length < STATS_PAGE_SIZE || (total !== null && rows.length >= total)) break;
    }
    return rows;
  }

  override async getRecentPlayerStats(
    player: ResolvedPlayer,
    count: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerFixtureStat[]> {
    const rawRows = await this.loadRawStats(player.id);

    const teamIds = Array.from(
      new Set(
        [
          player.teamId,
          ...rawRows.map(rawTeamId),
        ].filter((teamId): teamId is number => teamId !== null),
      ),
    ).slice(0, MAX_RECENT_TEAMS);

    const fixtureGroups = await Promise.all(
      teamIds.map((teamId) => this.football.getRecentTeamFixtures(teamId, TEAM_FIXTURE_HISTORY)),
    );
    const fixturesById = new Map<number, ProviderFixture>();
    for (const fixture of fixtureGroups.flat()) fixturesById.set(fixture.id, fixture);

    const stats = hydrateBsdPlayerStatRows({
      rows: rawRows,
      fixtures: [...fixturesById.values()],
      player,
      competitionNames,
    });

    console.info("[bsd-player] player fixture stats enriched", {
      playerId: player.id,
      requested: count,
      rawRows: rawRows.length,
      teamIds,
      fixtureMetadata: fixturesById.size,
      parsed: stats.length,
      latestFixtureIds: stats.slice(-Math.min(count, 10)).map((row) => row.fixtureId),
    });

    return stats.slice(-Math.max(count, 1));
  }
}
