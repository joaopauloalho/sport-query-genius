import { AnalysisPipelineError, type AnalysisErrorCode } from "../../src/server/analysis/errors";
import type { ProviderFixture, ResolvedTeam } from "../../src/server/sports/provider";
import type { TeamMetric } from "../../src/server/sports/metric-catalog";
import type { NormalizedTeamFixtureStats } from "../../src/server/sports/fixture-stats";
import type {
  FootballIncident,
  ProviderFixtureScope,
  UniversalFootballSource,
  UniversalProviderName,
} from "../../src/server/sports/universal-football";

export const corinthians: ResolvedTeam = { id: 167, name: "Corinthians", country: "Brazil" };
export const palmeiras: ResolvedTeam = { id: 176, name: "Palmeiras", country: "Brazil" };
export const flamengo: ResolvedTeam = { id: 172, name: "Flamengo", country: "Brazil" };

export function fixture(
  id: number,
  date: string,
  home: ResolvedTeam,
  away: ResolvedTeam,
  homeGoals: number,
  awayGoals: number,
  competition = "Brasileirão Série A",
  competitionId = "71",
  seasonId = "2026",
): ProviderFixture {
  return {
    id,
    date: `${date}T20:00:00.000Z`,
    timestamp: Math.floor(Date.parse(`${date}T20:00:00.000Z`) / 1000),
    status: "finished",
    competition,
    competitionId,
    seasonId,
    country: "Brazil",
    home,
    away,
    goals: { home: homeGoals, away: awayGoals },
  };
}

export const controlledFixtures = [
  fixture(101, "2026-08-01", corinthians, palmeiras, 2, 1), // win
  fixture(102, "2026-08-08", flamengo, corinthians, 0, 1), // win
  fixture(103, "2026-08-15", palmeiras, corinthians, 3, 1), // loss
  fixture(104, "2026-08-18", corinthians, flamengo, 0, 0), // draw
];

export function snapshot(params: {
  provider?: UniversalProviderName;
  item: ProviderFixture;
  teamId?: number;
  values?: Partial<Record<TeamMetric, number | null>>;
  supported?: readonly TeamMetric[];
}): NormalizedTeamFixtureStats {
  const provider = params.provider ?? "BSD";
  const teamId = params.teamId ?? corinthians.id;
  const supported =
    params.supported ??
    ([
      "shots",
      "shots_on_target",
      "shots_off_target",
      "blocked_shots",
      "offsides",
      "corners",
      "passes",
      "accurate_passes",
      "pass_accuracy",
      "possession",
      "fouls",
      "yellow_cards",
      "red_cards",
      "cards",
      ...(provider === "BSD" ? ["xg" as const] : ["saves" as const]),
    ] as const);
  const values: NormalizedTeamFixtureStats["values"] = {};
  for (const metric of supported) {
    const has = Object.prototype.hasOwnProperty.call(params.values ?? {}, metric);
    const value = has ? (params.values?.[metric] ?? null) : null;
    values[metric] = {
      value,
      observed: has && value !== null,
      source: provider,
      unit: ["possession", "pass_accuracy"].includes(metric) ? "%" : "count",
      rawLabel: has ? metric : null,
    };
  }
  const observed = supported.filter((metric) => values[metric]?.observed === true);
  return {
    fixtureId: params.item.id,
    teamId,
    opponentId: params.item.home.id === teamId ? params.item.away.id : params.item.home.id,
    provider,
    competitionId: params.item.competitionId ?? null,
    seasonId: params.item.seasonId ?? null,
    values,
    coverage: {
      supported: [...supported],
      observed,
      missing: supported.filter((metric) => !observed.includes(metric)),
    },
    fetchedAt: "2026-08-25T12:00:00.000Z",
  };
}

export class Phase5bFakeSource implements UniversalFootballSource {
  readonly metricValues = new Map<string, number | null>();
  readonly statsReads: string[] = [];
  readonly fixtureScopes: ProviderFixtureScope[] = [];
  legacyMetricCalls = 0;
  resolveCalls = 0;
  fixtureReads = 0;
  seasonReads = 0;
  errorOnResolve: AnalysisErrorCode | null = null;
  errorOnFixtures: AnalysisErrorCode | null = null;
  errorOnStats: AnalysisErrorCode | null = null;
  seasonCurrent = true;
  seasonId = "2026";
  seasonLabel = "2026";
  competitionId = "71";
  startDate = "2026-01-01";
  endDate = "2026-12-31";

  constructor(
    readonly name: UniversalProviderName = "BSD",
    readonly fixtures: ProviderFixture[] = controlledFixtures,
  ) {}

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    this.resolveCalls += 1;
    if (this.errorOnResolve)
      throw new AnalysisPipelineError(this.errorOnResolve, `${this.name} resolve`);
    if (name === "Corinthians") return corinthians;
    if (name === "Palmeiras") return palmeiras;
    if (name === "Flamengo") return flamengo;
    throw new AnalysisPipelineError("TEAM_NOT_FOUND", `${this.name} team not found`);
  }

  async listTeamFixtures(_team: ResolvedTeam, scope: ProviderFixtureScope) {
    this.fixtureReads += 1;
    this.fixtureScopes.push({ ...scope });
    if (this.errorOnFixtures)
      throw new AnalysisPipelineError(this.errorOnFixtures, `${this.name} fixtures`);
    return {
      fixtures: this.fixtures,
      meta: {
        provider: this.name,
        endpoint: this.name === "BSD" ? "/api/v2/events/" : "/fixtures",
        dataFamily: "fixtures",
        fetchedAt: "2026-08-25T12:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async getFixtureIncidents() {
    return {
      incidents: [] as FootballIncident[],
      meta: {
        provider: this.name,
        endpoint: "/incidents",
        dataFamily: "incidents",
        fetchedAt: "2026-08-25T12:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async enrichGoalEvents(_fixture: ProviderFixture, incidents: readonly FootballIncident[]) {
    return { incidents: [...incidents], meta: null };
  }

  async getFixtureStats(item: ProviderFixture, teamId: number) {
    this.statsReads.push(String(item.id));
    if (this.errorOnStats) throw new AnalysisPipelineError(this.errorOnStats, `${this.name} stats`);
    const values: Partial<Record<TeamMetric, number | null>> = {};
    for (const [key, value] of this.metricValues) {
      const [fixtureId, metric] = key.split(":");
      if (fixtureId === String(item.id)) values[metric as TeamMetric] = value;
    }
    const snap = snapshot({ provider: this.name, item, teamId, values });
    return {
      snapshot: snap,
      meta: {
        provider: this.name,
        endpoint:
          this.name === "BSD"
            ? `/api/v2/events/${item.id}/stats/`
            : `/fixtures/statistics?fixture=${item.id}`,
        dataFamily: "fixture_stats",
        fetchedAt: "2026-08-25T12:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async resolveCompetitionSeason(competition: string, season: string) {
    this.seasonReads += 1;
    if ((season === "current" || season === "atual") && !this.seasonCurrent) {
      throw new AnalysisPipelineError("DATA_INSUFFICIENT", "provider has no unique current season");
    }
    return {
      season: {
        provider: this.name,
        competitionId: this.competitionId,
        seasonId: this.seasonId,
        label: this.seasonLabel,
        startDate: this.startDate,
        endDate: this.endDate,
        current: this.seasonCurrent,
        country: "Brazil",
        coverage: { statistics_fixtures: true },
        competition,
      },
      meta: {
        provider: this.name,
        endpoint: this.name === "BSD" ? `/leagues/${this.competitionId}/seasons/` : "/leagues",
        dataFamily: "league_season",
        fetchedAt: "2026-08-25T12:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async getFixtureMetric() {
    this.legacyMetricCalls += 1;
    return null;
  }
}
