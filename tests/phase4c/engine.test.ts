import { describe, expect, test } from "bun:test";

import { analyzePhase4cUniversalTeamPlanWithSources } from "../../src/server/analysis/analyze-team-universal.server";
import { AnalysisPipelineError } from "../../src/server/analysis/errors";
import { queryPlanSchema } from "../../src/server/analysis/query-plan";
import type { ProviderFixture, ResolvedTeam } from "../../src/server/sports/provider";
import type {
  FootballIncident,
  UniversalFootballSource,
} from "../../src/server/sports/universal-football";

const corinthians: ResolvedTeam = { id: 1, name: "Corinthians", country: "Brazil" };
const palmeiras: ResolvedTeam = { id: 2, name: "Palmeiras", country: "Brazil" };
const flamengo: ResolvedTeam = { id: 3, name: "Flamengo", country: "Brazil" };

function fixture(
  id: number,
  date: string,
  home: ResolvedTeam,
  away: ResolvedTeam,
  homeGoals: number,
  awayGoals: number,
  competition = "Brasileirão Série A",
): ProviderFixture {
  return {
    id,
    date: `${date}T20:00:00.000Z`,
    timestamp: Math.floor(Date.parse(`${date}T20:00:00.000Z`) / 1000),
    status: "finished",
    competition,
    home,
    away,
    goals: { home: homeGoals, away: awayGoals },
  };
}

const controlled: ProviderFixture[] = [
  fixture(101, "2026-08-01", corinthians, palmeiras, 2, 1),
  fixture(102, "2026-08-08", flamengo, corinthians, 0, 1),
  fixture(103, "2026-08-15", palmeiras, corinthians, 3, 1),
  fixture(104, "2026-08-18", corinthians, flamengo, 0, 0),
];

const season38 = Array.from({ length: 38 }, (_, index) => {
  const day = String((index % 28) + 1).padStart(2, "0");
  const month = String(Math.floor(index / 28) + 3).padStart(2, "0");
  const home = index % 2 === 0 ? corinthians : palmeiras;
  const away = index % 2 === 0 ? palmeiras : corinthians;
  return fixture(1000 + index, `2026-${month}-${day}`, home, away, index % 4, (index + 1) % 3);
});

class FakeSource implements UniversalFootballSource {
  readonly name = "BSD" as const;
  metricValues = new Map<string, number | null>();
  metricCalls: string[] = [];
  fixtureReads = 0;

  constructor(private readonly fixtures: ProviderFixture[] = controlled) {}

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    if (name === "Corinthians") return corinthians;
    if (name === "Palmeiras") return palmeiras;
    if (name === "Flamengo") return flamengo;
    throw new AnalysisPipelineError("TEAM_NOT_FOUND", "fake team not found");
  }

  async listTeamFixtures() {
    this.fixtureReads += 1;
    return {
      fixtures: this.fixtures,
      meta: {
        provider: this.name,
        endpoint: "/fake/fixtures",
        dataFamily: "fixtures",
        fetchedAt: "2026-08-23T03:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async getFixtureIncidents() {
    return {
      incidents: [] as FootballIncident[],
      meta: {
        provider: this.name,
        endpoint: "/fake/incidents",
        dataFamily: "incidents",
        fetchedAt: "2026-08-23T03:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async enrichGoalEvents(_fixture: ProviderFixture, incidents: readonly FootballIncident[]) {
    return { incidents: [...incidents], meta: null };
  }

  async getFixtureMetric(
    item: ProviderFixture,
    _teamId: number,
    metric: "goals" | "corners" | "shots" | "shots_on_target" | "cards",
  ) {
    const key = `${item.id}:${metric}`;
    this.metricCalls.push(key);
    return this.metricValues.get(key) ?? null;
  }
}

function aggregatePlan(overrides: Record<string, unknown> = {}) {
  return queryPlanSchema.parse({
    sport: "football",
    entity: { type: "team", name: "Corinthians" },
    query_kind: "aggregate",
    metric: "goals_against",
    aggregation: "average",
    scope: { venue: "all", half: "full", status: "finished" },
    ...overrides,
  });
}

describe("Phase 4C deterministic team engine", () => {
  test("last 30 works without the old 20-match ceiling", async () => {
    const plan = aggregatePlan({
      scope: { last_matches: 30, venue: "all", half: "full", status: "finished" },
    });
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "Qual foi a média de gols sofridos do Corinthians nos últimos 30 jogos?",
      plan,
      sources: [new FakeSource(season38)],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.statistics.sample_size).toBe(30);
    expect(result.provenance.sample_size).toBe(30);
  });

  test("whole competition season uses all 38 fixtures and no default five", async () => {
    const plan = aggregatePlan({
      scope: {
        season: "2026",
        competition: "Brasileirão Série A",
        venue: "all",
        half: "full",
        status: "finished",
      },
    });
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "No Brasileirão 2026, qual foi a média de gols sofridos do Corinthians?",
      plan,
      sources: [new FakeSource(season38)],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.statistics.sample_size).toBe(38);
    expect(result.intent.match_count).toBe(38);
  });

  test("explicit current season keeps a partial sample instead of completing from another competition", async () => {
    const plan = aggregatePlan({
      scope: {
        season: "2026",
        competition: "Brasileirão Série A",
        venue: "all",
        half: "full",
      },
    });
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "Brasileirão 2026",
      plan,
      sources: [new FakeSource(season38.slice(0, 19))],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.statistics.sample_size).toBe(19);
  });

  test("goals_against is derived from the opposite side of the real score for home and away", async () => {
    const all = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "gols sofridos",
      plan: aggregatePlan({ aggregation: "total", scope: { last_matches: 4, venue: "all", half: "full" } }),
      sources: [new FakeSource()],
    });
    const home = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "gols sofridos em casa",
      plan: aggregatePlan({ aggregation: "total", scope: { venue: "home", half: "full", season: "2026" } }),
      sources: [new FakeSource()],
    });
    const away = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "gols sofridos fora",
      plan: aggregatePlan({ aggregation: "total", scope: { venue: "away", half: "full", season: "2026" } }),
      sources: [new FakeSource()],
    });
    expect(all.result_type).toBe("aggregate");
    expect(home.result_type).toBe("aggregate");
    expect(away.result_type).toBe("aggregate");
    if (all.result_type !== "aggregate" || home.result_type !== "aggregate" || away.result_type !== "aggregate") return;
    expect(all.answer.value).toBe(4);
    expect(home.answer.value).toBe(1);
    expect(away.answer.value).toBe(3);
  });

  test("score-derived metrics share the fixture dataset and never call fixture statistics", async () => {
    const source = new FakeSource();
    for (const [metric, aggregation, expected] of [
      ["goals_against", "total", 4],
      ["clean_sheets", "count", 2],
      ["both_teams_scored", "count", 2],
      ["wins", "count", 2],
      ["losses", "count", 1],
    ] as const) {
      const result = await analyzePhase4cUniversalTeamPlanWithSources({
        question: `${metric}`,
        plan: aggregatePlan({ metric, aggregation, scope: { last_matches: 4, venue: "all", half: "full" } }),
        sources: [source],
      });
      expect(result.result_type).toBe("aggregate");
      if (result.result_type === "aggregate") expect(result.answer.value).toBe(expected);
    }
    expect(source.metricCalls).toHaveLength(0);
    expect(source.fixtureReads).toBe(5);
  });

  test("BTTS percentage and points efficiency use explicit deterministic denominators", async () => {
    const btts = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "percentual ambos marcam",
      plan: aggregatePlan({
        metric: "both_teams_scored",
        aggregation: "percentage",
        scope: { season: "2026", venue: "all", half: "full" },
      }),
      sources: [new FakeSource()],
    });
    const points = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "aproveitamento",
      plan: aggregatePlan({
        metric: "points",
        aggregation: "percentage",
        scope: { season: "2026", venue: "all", half: "full" },
      }),
      sources: [new FakeSource()],
    });
    expect(btts.result_type).toBe("aggregate");
    expect(points.result_type).toBe("aggregate");
    if (btts.result_type === "aggregate") expect(btts.answer.value).toBe(50);
    if (points.result_type === "aggregate") expect(points.answer.value).toBeCloseTo((7 / 12) * 100, 2);
  });

  test("generic outcome and numeric filters are applied before aggregation", async () => {
    const losses = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "média nos jogos que perdeu",
      plan: aggregatePlan({
        filters: [{ field: "outcome", operator: "eq", value: "loss" }],
        scope: { season: "2026", venue: "all", half: "full" },
      }),
      sources: [new FakeSource()],
    });
    const concededTwo = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "quantos sofreu 2 ou mais",
      plan: aggregatePlan({
        metric: "goals_for",
        aggregation: "count",
        filters: [{ field: "goals_against", operator: "gte", value: 2 }],
        scope: { season: "2026", venue: "all", half: "full" },
      }),
      sources: [new FakeSource()],
    });
    expect(losses.result_type).toBe("aggregate");
    expect(concededTwo.result_type).toBe("aggregate");
    if (losses.result_type === "aggregate") {
      expect(losses.statistics.sample_size).toBe(1);
      expect(losses.answer.value).toBe(3);
    }
    if (concededTwo.result_type === "aggregate") expect(concededTwo.answer.value).toBe(1);
  });

  test("raw metric planner fetches statistics only for fixtures that survived filters", async () => {
    const source = new FakeSource();
    source.metricValues.set("101:corners", 7);
    source.metricValues.set("102:corners", 5);
    const plan = aggregatePlan({
      metric: "corners",
      aggregation: "average",
      filters: [{ field: "outcome", operator: "eq", value: "win" }],
      scope: { season: "2026", venue: "all", half: "full" },
    });
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "média de escanteios nos jogos que venceu",
      plan,
      sources: [source],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.answer.value).toBe(6);
    expect(source.metricCalls.sort()).toEqual(["101:corners", "102:corners"]);
  });

  test("raw metric null remains null and fails strict complete-sample policy", async () => {
    const source = new FakeSource(controlled.slice(0, 2));
    source.metricValues.set("101:corners", 7);
    source.metricValues.set("102:corners", null);
    await expect(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "média de escanteios",
        plan: aggregatePlan({
          metric: "corners",
          aggregation: "average",
          scope: { season: "2026", venue: "all", half: "full" },
        }),
        sources: [source],
      }),
    ).rejects.toMatchObject({ code: "DATA_INSUFFICIENT" });
  });

  test("group_by venue calculates home and away from the same complete input sample", async () => {
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "Compare gols sofridos em casa e fora",
      plan: aggregatePlan({
        group_by: ["venue"],
        scope: { season: "2026", competition: "Brasileirão Série A", venue: "all", half: "full" },
      }),
      sources: [new FakeSource()],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.result_kind).toBe("grouped_aggregate");
    expect(result.groups).toEqual([
      expect.objectContaining({ dimensions: { venue: "Casa" }, value: 0.5, sample_size: 2 }),
      expect.objectContaining({ dimensions: { venue: "Fora" }, value: 1.5, sample_size: 2 }),
    ]);
  });

  test("match_list reuses scope + filters and limit only trims output after filtering", async () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "match_list",
      scope: { season: "2026", competition: "Brasileirão Série A", venue: "all", half: "full" },
      filters: [{ field: "goals_against", operator: "gte", value: 1 }],
      limit: 2,
    });
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "Mostre os jogos em que sofreu pelo menos um gol",
      plan,
      sources: [new FakeSource()],
    });
    expect(result.result_type).toBe("match_list");
    if (result.result_type !== "match_list") return;
    expect(result.matches.map((match) => match.fixture_id)).toEqual(["101", "103"]);
    expect(result.provenance.sample_size).toBe(2);
  });
});
