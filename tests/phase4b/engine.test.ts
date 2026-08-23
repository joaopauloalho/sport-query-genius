import { describe, expect, test } from "bun:test";

import {
  analyzeUniversalQueryPlanWithSources,
} from "../../src/server/analysis/analyze-universal.server";
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

const finishedFixtures: ProviderFixture[] = [
  {
    id: 101,
    date: "2026-08-01T20:00:00.000Z",
    timestamp: 1785614400,
    status: "finished",
    competition: "Brasileirão Série A",
    home: corinthians,
    away: palmeiras,
    goals: { home: 2, away: 1 },
  },
  {
    id: 102,
    date: "2026-08-08T20:00:00.000Z",
    timestamp: 1786219200,
    status: "finished",
    competition: "Brasileirão Série A",
    home: flamengo,
    away: corinthians,
    goals: { home: 0, away: 1 },
  },
  {
    id: 103,
    date: "2026-08-15T20:00:00.000Z",
    timestamp: 1786824000,
    status: "finished",
    competition: "Brasileirão Série A",
    home: palmeiras,
    away: corinthians,
    goals: { home: 1, away: 1 },
  },
  {
    id: 104,
    date: "2026-08-18T20:00:00.000Z",
    timestamp: 1787083200,
    status: "finished",
    competition: "Brasileirão Série A",
    home: corinthians,
    away: palmeiras,
    goals: { home: 3, away: 0 },
  },
];

const upcomingFixtures: ProviderFixture[] = [
  {
    id: 201,
    date: "2026-08-28T23:00:00.000Z",
    timestamp: 1787958000,
    status: "upcoming",
    competition: "Brasileirão Série A",
    home: corinthians,
    away: flamengo,
    goals: { home: null, away: null },
  },
  {
    id: 202,
    date: "2026-09-03T23:00:00.000Z",
    timestamp: 1788476400,
    status: "upcoming",
    competition: "Brasileirão Série A",
    home: palmeiras,
    away: corinthians,
    goals: { home: null, away: null },
  },
];

const incident = (params: Partial<FootballIncident> & Pick<FootballIncident, "fixtureId" | "eventKey" | "eventType">): FootballIncident => ({
  teamId: 1,
  teamName: "Corinthians",
  actor: { id: 10, name: "Yuri Alberto" },
  secondaryActor: null,
  minute: 10,
  extraTime: null,
  periodSecond: null,
  detail: null,
  rescinded: false,
  situation: null,
  bodyPart: null,
  xg: null,
  xgEstimated: null,
  source: "BSD",
  ...params,
});

class FakeSource implements UniversalFootballSource {
  readonly name = "BSD" as const;
  metricValues = new Map<string, number | null>();

  constructor(
    private readonly incidentsByFixture: Record<number, FootballIncident[]> = {},
    private readonly fail = false,
  ) {}

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    if (this.fail) {
      throw new AnalysisPipelineError("PROVIDER_UNAVAILABLE", "provider fake indisponível");
    }
    if (name === "Corinthians") return corinthians;
    if (name === "Palmeiras") return palmeiras;
    if (name === "Flamengo") return flamengo;
    throw new AnalysisPipelineError("TEAM_NOT_FOUND", "time fake não encontrado");
  }

  async listTeamFixtures(_team: ResolvedTeam, scope: Parameters<UniversalFootballSource["listTeamFixtures"]>[1]) {
    if (this.fail) {
      throw new AnalysisPipelineError("PROVIDER_UNAVAILABLE", "provider fake indisponível");
    }
    const fixtures = scope.status === "upcoming" ? upcomingFixtures : finishedFixtures;
    return {
      fixtures,
      meta: {
        provider: this.name,
        endpoint: "/fake/fixtures",
        dataFamily: "fixtures",
        fetchedAt: "2026-08-23T03:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async getFixtureIncidents(fixture: ProviderFixture) {
    return {
      incidents: this.incidentsByFixture[fixture.id] ?? [],
      meta: {
        provider: this.name,
        endpoint: `/fake/${fixture.id}/incidents`,
        dataFamily: "incidents",
        fetchedAt: "2026-08-23T03:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    };
  }

  async enrichGoalEvents(_fixture: ProviderFixture, incidents: readonly FootballIncident[]) {
    return { incidents: [...incidents], meta: null };
  }

  async getFixtureMetric(fixture: ProviderFixture, _teamId: number, metric: "goals" | "corners" | "shots" | "shots_on_target" | "cards") {
    return this.metricValues.get(`${fixture.id}:${metric}`) ?? null;
  }
}

describe("Phase 4B deterministic universal engine", () => {
  test("team goal query keeps multiple same-player goals as separate events", async () => {
    const source = new FakeSource({
      103: [incident({ fixtureId: 103, eventKey: "103:g1", eventType: "goal", minute: 12 })],
      104: [
        incident({ fixtureId: 104, eventKey: "104:g1", eventType: "goal", minute: 20 }),
        incident({ fixtureId: 104, eventKey: "104:g2", eventType: "goal", minute: 60 }),
      ],
    });
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "event_list",
      event_type: "goal",
      scope: { last_matches: 2, venue: "all", half: "full" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Quem fez gol do Corinthians nos últimos 2 jogos?",
      plan,
      sources: [source],
    });

    expect(result.result_type).toBe("event_list");
    if (result.result_type !== "event_list") return;
    expect(result.events).toHaveLength(3);
    expect(new Set(result.events.map((event) => event.event_key)).size).toBe(3);
    expect(result.events.filter((event) => event.player_name === "Yuri Alberto")).toHaveLength(3);
    expect(result.provenance.sample_size).toBe(2);
  });

  test("rescinded cards are excluded by the deterministic event conversion", async () => {
    const source = new FakeSource({
      104: [
        incident({
          fixtureId: 104,
          eventKey: "104:y1",
          eventType: "yellow_card",
          actor: { id: 40, name: "Cartão válido" },
          rescinded: false,
        }),
        incident({
          fixtureId: 104,
          eventKey: "104:y2",
          eventType: "yellow_card",
          actor: { id: 41, name: "Cartão anulado" },
          rescinded: true,
        }),
      ],
    });
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "event_list",
      event_type: "yellow_card",
      scope: { last_matches: 1, venue: "all", half: "full" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Quem tomou amarelo no Corinthians no último jogo?",
      plan,
      sources: [source],
    });
    expect(result.result_type).toBe("event_list");
    if (result.result_type !== "event_list") return;
    expect(result.events.map((event) => event.player_name)).toEqual(["Cartão válido"]);
  });

  test("match_list returns the exact last-N window without replacing fixtures", async () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "match_list",
      scope: { last_matches: 2, venue: "all", half: "full", status: "finished" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Quais foram os últimos 2 jogos do Corinthians?",
      plan,
      sources: [new FakeSource()],
    });
    expect(result.result_type).toBe("match_list");
    if (result.result_type !== "match_list") return;
    expect(result.matches.map((match) => match.fixture_id)).toEqual(["103", "104"]);
    expect(result.provenance.sample_size).toBe(2);
  });

  test("schedule returns nearest upcoming fixtures first", async () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "schedule",
      scope: { last_matches: 2, venue: "all", half: "full", status: "upcoming" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Quais os próximos 2 jogos do Corinthians?",
      plan,
      sources: [new FakeSource()],
    });
    expect(result.result_type).toBe("match_list");
    if (result.result_type !== "match_list") return;
    expect(result.matches.map((match) => match.fixture_id)).toEqual(["201", "202"]);
    expect(result.intent.status).toBe("upcoming");
  });

  test("H2H resolves both teams and calculates wins/draws/goals deterministically", async () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "head_to_head",
      scope: { last_matches: 3, venue: "all", half: "full" },
      compare_with: { type: "team", name: "Palmeiras" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Últimos 3 Corinthians x Palmeiras",
      plan,
      sources: [new FakeSource()],
    });
    expect(result.result_type).toBe("head_to_head");
    if (result.result_type !== "head_to_head") return;
    expect(result.meetings.map((match) => match.fixture_id)).toEqual(["101", "103", "104"]);
    expect(result.summary.team_a_wins).toBe(2);
    expect(result.summary.draws).toBe(1);
    expect(result.summary.team_b_wins).toBe(0);
    expect(result.summary.team_a_goals).toBe(6);
    expect(result.summary.team_b_goals).toBe(2);
    expect(result.summary.average_total_goals).toBeCloseTo(8 / 3, 2);
  });

  test("H2H metric refuses incomplete coverage instead of converting null to zero", async () => {
    const source = new FakeSource();
    source.metricValues.set("101:corners", 7);
    source.metricValues.set("103:corners", null);
    source.metricValues.set("104:corners", 5);
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "head_to_head",
      metric: "corners",
      aggregation: "average",
      scope: { last_matches: 3, venue: "all", half: "full" },
      compare_with: { type: "team", name: "Palmeiras" },
    });

    await expect(
      analyzeUniversalQueryPlanWithSources({
        question: "Qual média de escanteios do Corinthians contra o Palmeiras nos últimos 3?",
        plan,
        sources: [source],
      }),
    ).rejects.toMatchObject({ code: "DATA_INSUFFICIENT" });
  });

  test("capability-aware fallback uses second provider only after a retryable provider failure", async () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "match_list",
      scope: { last_matches: 1, venue: "all", half: "full", status: "finished" },
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "Qual foi o último jogo do Corinthians?",
      plan,
      sources: [new FakeSource({}, true), new FakeSource()],
    });
    expect(result.source.provider).toBe("BSD");
    expect(result.result_type).toBe("match_list");
  });
});
