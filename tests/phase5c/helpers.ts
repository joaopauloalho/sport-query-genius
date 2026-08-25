import type { NormalizedPlayerMatchStats } from "../../src/server/sports/player-match-stats";
import type { PlayerMetricKey } from "../../src/server/sports/metric-catalog";
import type { ResolvedPlayer } from "../../src/server/sports/player-provider";

export const yuri: ResolvedPlayer = {
  id: 1001,
  name: "Yuri Alberto",
  teamId: 167,
  teamName: "Corinthians",
  position: "Forward",
  country: "Brazil",
};

function metricValue(metric: PlayerMetricKey, value: number | null, observed = value !== null) {
  return {
    value,
    observed,
    source: "BSD" as const,
    unit: metric === "rating" ? "rating" : metric === "minutes" ? "minutes" : "count",
    rawLabel: observed ? metric : null,
  };
}

export function playerSnapshot(params: {
  id: number;
  date: string;
  venue?: "home" | "away";
  opponent?: string;
  competition?: string;
  seasonId?: string;
  outcome?: "win" | "draw" | "loss" | null;
  participated?: boolean;
  values?: Partial<Record<PlayerMetricKey, number | null>>;
}): NormalizedPlayerMatchStats {
  const venue = params.venue ?? "home";
  const opponentName = params.opponent ?? `Opponent ${params.id}`;
  const values = params.values ?? {};
  const metrics: NormalizedPlayerMatchStats["metrics"] = {};
  for (const [metric, value] of Object.entries(values) as Array<[PlayerMetricKey, number | null]>) {
    metrics[metric] = metricValue(metric, value);
  }
  if (!Object.prototype.hasOwnProperty.call(values, "minutes")) {
    metrics.minutes = metricValue("minutes", params.participated === false ? 0 : 90);
  }
  const goals = metrics.goals;
  const assists = metrics.assists;
  if (goals?.observed && assists?.observed && goals.value !== null && assists.value !== null) {
    metrics.goal_contributions = metricValue("goal_contributions", goals.value + assists.value);
  }
  const yellow = metrics.yellow_cards;
  const red = metrics.red_cards;
  if (yellow?.observed && red?.observed && yellow.value !== null && red.value !== null) {
    metrics.cards = metricValue("cards", yellow.value + red.value);
  }
  const supported = Object.keys(metrics) as PlayerMetricKey[];
  const observed = supported.filter((metric) => metrics[metric]?.observed);
  const timestamp = Math.floor(Date.parse(`${params.date}T20:00:00.000Z`) / 1000);
  return {
    fixtureId: params.id,
    playerId: yuri.id,
    teamId: yuri.teamId as number,
    teamName: yuri.teamName as string,
    opponentId: 2000 + params.id,
    opponentName,
    competitionId: params.competition === "Premier League" ? "39" : "71",
    competitionName: params.competition ?? "Brasileirão Série A",
    seasonId: params.seasonId ?? "2026",
    seasonLabel: params.seasonId ?? "2026",
    date: `${params.date}T20:00:00.000Z`,
    timestamp,
    venue,
    result: "2-1",
    outcome: params.outcome ?? "win",
    participated: params.participated ?? true,
    started: params.participated === false ? false : true,
    substitute: false,
    metrics,
    coverage: {
      supported,
      observed,
      missing: supported.filter((metric) => !observed.includes(metric)),
    },
    provenance: {
      provider: "BSD",
      rawLabels: observed,
      fetchedAt: "2026-08-25T15:00:00.000Z",
      endpoint: "/players/{player_id}/stats/",
      dataFamily: "player_match_stats",
    },
  };
}

export const controlledPlayerSnapshots = [
  playerSnapshot({
    id: 201,
    date: "2026-08-01",
    values: { passes: 30, shots: 2, rating: 6.5, goals: 0, assists: 0, tackles: 1 },
  }),
  playerSnapshot({
    id: 202,
    date: "2026-08-05",
    participated: false,
    values: { minutes: 0, passes: 0, shots: 0, rating: null, goals: 0, assists: 0, tackles: 0 },
  }),
  playerSnapshot({
    id: 203,
    date: "2026-08-10",
    venue: "away",
    values: { passes: 40, shots: 4, rating: 7.2, goals: 1, assists: 0, tackles: 2 },
  }),
  playerSnapshot({
    id: 204,
    date: "2026-08-15",
    venue: "away",
    opponent: "Palmeiras",
    values: { passes: 50, shots: 5, rating: 7.8, goals: 0, assists: 1, tackles: 3 },
  }),
  playerSnapshot({
    id: 205,
    date: "2026-08-20",
    values: { passes: 60, shots: 6, rating: 8.1, goals: 2, assists: 1, tackles: 4 },
  }),
];

export class Phase5cFakeSource {
  snapshotReads = 0;
  seasonReads = 0;

  constructor(public snapshots: NormalizedPlayerMatchStats[] = controlledPlayerSnapshots) {}

  async resolvePlayer() {
    return yuri;
  }

  async listPlayerSnapshots() {
    this.snapshotReads += 1;
    return {
      player: yuri,
      snapshots: this.snapshots,
      meta: {
        provider: "BSD" as const,
        endpoint: "/players/{player_id}/stats/ + /events/",
        dataFamily: "player_match_stats",
        fetchedAt: "2026-08-25T15:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async resolveCompetitionSeason(competition: string, season: string) {
    this.seasonReads += 1;
    return {
      season: {
        provider: "BSD" as const,
        competitionId: competition === "Premier League" ? "39" : "71",
        seasonId: season === "2025/26" ? "2025" : "2026",
        label: season,
        startDate: season === "2025/26" ? "2025-08-01" : "2026-01-01",
        endDate: season === "2025/26" ? "2026-05-31" : "2026-12-31",
        current: true,
        country: competition === "Premier League" ? "England" : "Brazil",
        coverage: { statistics_fixtures: true },
        competition,
      },
      meta: {
        provider: "BSD" as const,
        endpoint: "/leagues/71/seasons/",
        dataFamily: "league_season",
        fetchedAt: "2026-08-25T15:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }
}
