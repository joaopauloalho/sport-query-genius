import type { PlayerFixtureStat, ResolvedPlayer } from "../player-provider.ts";
import type { ProviderFixture } from "../provider.ts";

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
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

export function bsdPlayerStatTeamId(row: Record<string, unknown>): number | null {
  return readNumber(row, ["team_id", "club_id"]);
}

export function bsdPlayerStatFixtureId(row: Record<string, unknown>): number | null {
  return readNumber(row, ["event_id", "fixture_id", "match_id"]);
}

function hydratePlayerStat(
  row: Record<string, unknown>,
  fixture: ProviderFixture,
  player: ResolvedPlayer,
): PlayerFixtureStat | null {
  const fixtureId = bsdPlayerStatFixtureId(row);
  const teamId = bsdPlayerStatTeamId(row) ?? player.teamId;
  if (fixtureId === null || fixture.id !== fixtureId || teamId === null) return null;

  const isHome = fixture.home.id === teamId;
  const isAway = fixture.away.id === teamId;
  if (!isHome && !isAway) return null;

  const minutes = readNumber(row, ["minutes_played", "minutes", "mins", "min"]);
  const goals = readNumber(row, ["goals", "goals_total"]);
  const assists = readNumber(row, ["goal_assist", "goal_assists", "assists"]);
  const shots = readNumber(row, ["total_shots", "shots_total", "shots"]);
  const shotsOnTarget = readNumber(row, ["shots_on_target", "shots_target", "shots_on"]);
  const yellow = readNumber(row, ["yellow_card", "yellow_cards", "cards_yellow"]);
  const red = readNumber(row, ["red_card", "red_cards", "cards_red"]);
  const directCards = readNumber(row, ["cards", "total_cards"]);
  const cards =
    directCards ?? (yellow !== null || red !== null ? (yellow ?? 0) + (red ?? 0) : null);

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
    const fixtureId = bsdPlayerStatFixtureId(row);
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
