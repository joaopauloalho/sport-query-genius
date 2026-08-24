import { describe, expect, test } from "bun:test";

import {
  analyzePhase4cWithFreshnessFallback,
  newestResultFixtureTimestamp,
  shouldVerifyRecentFixtureFreshness,
} from "../../src/server/analysis/phase4c-freshness.server";
import { AnalysisPipelineError } from "../../src/server/analysis/errors";
import { queryPlanSchema } from "../../src/server/analysis/query-plan";
import type { ProviderFixture, ResolvedTeam } from "../../src/server/sports/provider";
import type {
  FootballIncident,
  UniversalFootballSource,
  UniversalProviderName,
} from "../../src/server/sports/universal-football";

const corinthians: ResolvedTeam = { id: 1, name: "Corinthians", country: "Brazil" };
const opponent: ResolvedTeam = { id: 2, name: "Adversário", country: "Brazil" };

function fixture(
  id: number,
  date: string,
  homeGoals: number,
  awayGoals: number,
): ProviderFixture {
  return {
    id,
    date: `${date}T20:00:00.000Z`,
    timestamp: Math.floor(Date.parse(`${date}T20:00:00.000Z`) / 1000),
    status: "finished",
    competition: "Competição de teste",
    home: corinthians,
    away: opponent,
    goals: { home: homeGoals, away: awayGoals },
  };
}

const stalePrimary = [
  fixture(101, "2026-08-10", 1, 0),
  fixture(102, "2026-08-14", 2, 0),
  fixture(103, "2026-08-18", 3, 0),
];

const fresherFallback = [
  fixture(201, "2026-08-10", 1, 0),
  fixture(202, "2026-08-14", 2, 0),
  fixture(203, "2026-08-18", 3, 0),
  fixture(204, "2026-08-22", 2, 1),
];

class FakeSource implements UniversalFootballSource {
  fixtureReads = 0;

  constructor(
    readonly name: UniversalProviderName,
    private readonly fixtures: ProviderFixture[],
    private readonly fixtureError: AnalysisPipelineError | null = null,
  ) {}

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    if (name !== corinthians.name) {
      throw new AnalysisPipelineError("TEAM_NOT_FOUND", "fake team not found");
    }
    return corinthians;
  }

  async listTeamFixtures() {
    this.fixtureReads += 1;
    if (this.fixtureError) throw this.fixtureError;
    return {
      fixtures: this.fixtures,
      meta: {
        provider: this.name,
        endpoint: "/fake/fixtures",
        dataFamily: "fixtures",
        fetchedAt: "2026-08-24T11:00:00.000Z",
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
        fetchedAt: "2026-08-24T11:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async enrichGoalEvents(_fixture: ProviderFixture, incidents: readonly FootballIncident[]) {
    return { incidents: [...incidents], meta: null };
  }

  async getFixtureMetric() {
    return null;
  }
}

function recentPlan() {
  return queryPlanSchema.parse({
    sport: "football",
    entity: { type: "team", name: "Corinthians" },
    query_kind: "aggregate",
    metric: "goals_for",
    aggregation: "total",
    scope: { last_matches: 3, venue: "all", half: "full", status: "finished" },
  });
}

const NOW = new Date("2026-08-24T12:00:00.000Z");

describe("Phase 4C recent-fixture freshness fallback", () => {
  test("a stale successful primary is cross-checked and a demonstrably fresher provider wins", async () => {
    const bsd = new FakeSource("BSD", stalePrimary);
    const api = new FakeSource("API-FOOTBALL", fresherFallback);

    const result = await analyzePhase4cWithFreshnessFallback({
      question: "Quantos gols o Corinthians marcou nos últimos 3 jogos?",
      plan: recentPlan(),
      sources: [bsd, api],
      now: NOW,
    });

    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.provenance.provider).toBe("API-FOOTBALL");
    expect(result.answer.value).toBe(7);
    expect(result.matches[0]?.date).toContain("2026-08-22");
    expect(bsd.fixtureReads).toBe(1);
    expect(api.fixtureReads).toBe(1);
  });

  test("a genuinely recent primary does not spend fallback quota", async () => {
    const freshPrimary = [...stalePrimary, fixture(104, "2026-08-23", 4, 0)];
    const bsd = new FakeSource("BSD", freshPrimary);
    const api = new FakeSource("API-FOOTBALL", fresherFallback);

    const result = await analyzePhase4cWithFreshnessFallback({
      question: "últimos jogos",
      plan: recentPlan(),
      sources: [bsd, api],
      now: NOW,
    });

    expect(result.provenance.provider).toBe("BSD");
    expect(api.fixtureReads).toBe(0);
  });

  test("a stale primary remains selected when the secondary source proves nothing newer", async () => {
    const bsd = new FakeSource("BSD", stalePrimary);
    const api = new FakeSource("API-FOOTBALL", stalePrimary.map((item) => ({ ...item, id: item.id + 100 })));

    const result = await analyzePhase4cWithFreshnessFallback({
      question: "últimos jogos",
      plan: recentPlan(),
      sources: [bsd, api],
      now: NOW,
    });

    expect(result.provenance.provider).toBe("BSD");
    expect(api.fixtureReads).toBe(1);
  });

  test("secondary-provider failure never erases an otherwise valid primary result", async () => {
    const bsd = new FakeSource("BSD", stalePrimary);
    const api = new FakeSource(
      "API-FOOTBALL",
      [],
      new AnalysisPipelineError("PROVIDER_UNAVAILABLE", "fallback unavailable in test"),
    );

    const result = await analyzePhase4cWithFreshnessFallback({
      question: "últimos jogos",
      plan: recentPlan(),
      sources: [bsd, api],
      now: NOW,
    });

    expect(result.provenance.provider).toBe("BSD");
    expect(api.fixtureReads).toBe(1);
  });

  test("explicit historical scopes are not freshness-probed", async () => {
    const plan = queryPlanSchema.parse({
      ...recentPlan(),
      scope: {
        last_matches: 3,
        season: "2026",
        venue: "all",
        half: "full",
        status: "finished",
      },
    });
    const bsd = new FakeSource("BSD", stalePrimary);
    const api = new FakeSource("API-FOOTBALL", fresherFallback);

    const result = await analyzePhase4cWithFreshnessFallback({
      question: "na temporada 2026",
      plan,
      sources: [bsd, api],
      now: NOW,
    });

    expect(result.provenance.provider).toBe("BSD");
    expect(api.fixtureReads).toBe(0);
  });

  test("freshness helpers use the newest real fixture in the result", async () => {
    const bsd = new FakeSource("BSD", stalePrimary);
    const result = await analyzePhase4cWithFreshnessFallback({
      question: "últimos jogos",
      plan: recentPlan(),
      sources: [bsd],
      now: NOW,
    });

    expect(newestResultFixtureTimestamp(result)).toBe(Date.parse("2026-08-18T20:00:00.000Z"));
    expect(shouldVerifyRecentFixtureFreshness(recentPlan(), result, undefined, NOW.getTime())).toBe(
      true,
    );
  });
});
