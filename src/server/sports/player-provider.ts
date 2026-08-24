export type PlayerMetric = "goals" | "shots" | "shots_on_target" | "cards";

export interface ResolvedPlayer {
  id: number;
  name: string;
  teamId: number | null;
  teamName: string | null;
  position: string | null;
  country: string;
}

export interface PlayerFixtureStat {
  fixtureId: number;
  date: string;
  timestamp: number;
  competition: string;
  teamId: number | null;
  teamName: string | null;
  opponentId: number | null;
  opponentName: string;
  venue: "home" | "away";
  result: string;
  minutes: number | null;
  goals: number | null;
  assists: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  cards: number | null;
  shotmapCovered: boolean;
  shotmapCheckedAt?: string | null;
  source: string;
  fetchedAt?: string;
}

export interface PlayerShotStats {
  coverage: boolean;
  shots: number | null;
  shotsOnTarget: number | null;
}

export interface PlayerGoalEvent {
  eventKey: string;
  fixtureId: number;
  date: string;
  timestamp: number;
  competition: string;
  teamId: number | null;
  teamName: string | null;
  opponentId: number | null;
  opponentName: string;
  venue: "home" | "away";
  result: string;
  minute: number | null;
  extraTime: number | null;
  situation: string | null;
  bodyPart: string | null;
  xg: number | null;
  xgEstimated: boolean | null;
  source: string;
  fetchedAt?: string;
}

export interface GoalEventFixtureResult {
  coverage: boolean;
  events: PlayerGoalEvent[];
}

export interface PlayerSportsDataProvider {
  readonly name: string;
  resolvePlayer(name: string): Promise<ResolvedPlayer>;
  getPlayerById(playerId: number): Promise<ResolvedPlayer>;
  getRecentPlayerStats(
    player: ResolvedPlayer,
    count: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerFixtureStat[]>;
  getFixtureShotStats(fixtureId: number, playerId: number): Promise<PlayerShotStats>;
  getGoalEventsForFixture(
    fixture: PlayerFixtureStat,
    playerId: number,
  ): Promise<GoalEventFixtureResult>;
}

export function playerParticipated(stat: PlayerFixtureStat): boolean {
  if (stat.minutes !== null && stat.minutes > 0) return true;
  if (stat.goals !== null && stat.goals > 0) return true;
  if (stat.assists !== null && stat.assists > 0) return true;
  return false;
}

export function playerMetricValue(stat: PlayerFixtureStat, metric: PlayerMetric): number | null {
  if (metric === "goals") return stat.goals;
  if (metric === "shots") return stat.shots;
  if (metric === "shots_on_target") return stat.shotsOnTarget;
  return stat.cards;
}
