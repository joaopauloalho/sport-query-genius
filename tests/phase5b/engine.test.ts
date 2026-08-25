import { describe, expect, test } from "bun:test";

import { analyzePhase4cUniversalTeamPlanWithSources } from "../../src/server/analysis/analyze-team-universal.server";
import { analyzeUniversalQueryPlanWithSources } from "../../src/server/analysis/analyze-universal.server";
import { AnalysisPipelineError } from "../../src/server/analysis/errors";
import {
  createSemanticPlan,
  semanticPlanResponseSchema,
} from "../../src/server/analysis/semantic-plan";
import { normalizeTruthfulSemanticCandidate } from "../../src/server/analysis/query-plan-v5a-normalizer";
import { queryPlanSchema } from "../../src/server/analysis/query-plan";
import { negotiateFootballCapability } from "../../src/server/sports/capability-negotiation";
import type { TeamMetric } from "../../src/server/sports/metric-catalog";
import { snapshot } from "./helpers";
import { controlledFixtures, corinthians, Phase5bFakeSource } from "./helpers";

function aggregatePlan(
  params: {
    metric?: string;
    aggregation?: string;
    filters?: Array<{ field: string; operator: string; value: unknown }>;
    scope?: Record<string, unknown>;
  } = {},
) {
  return queryPlanSchema.parse({
    sport: "football",
    entity: { type: "team", name: "Corinthians" },
    query_kind: "aggregate",
    metric: params.metric ?? "corners",
    aggregation: params.aggregation ?? "average",
    scope: params.scope ?? { last_matches: 4, venue: "all", half: "full", status: "finished" },
    filters: params.filters ?? [],
    group_by: [],
  });
}

function matchListPlan(
  params: {
    metric?: string;
    filters?: Array<{ field: string; operator: string; value: unknown }>;
    sort?: { field: string; direction: string };
    group_by?: string[];
  } = {},
) {
  return queryPlanSchema.parse({
    sport: "football",
    entity: { type: "team", name: "Corinthians" },
    query_kind: "match_list",
    metric: params.metric,
    scope: { last_matches: 4, venue: "all", half: "full", status: "finished" },
    filters: params.filters ?? [],
    group_by: params.group_by ?? [],
    ...(params.sort ? { sort: params.sort } : {}),
  });
}

function semantic(raw: unknown) {
  const normalized = normalizeTruthfulSemanticCandidate(raw);
  const parsed = semanticPlanResponseSchema.parse(normalized);
  if ("error" in parsed) throw new Error("unexpected semantic error");
  return createSemanticPlan(parsed, raw);
}

function setValues(source: Phase5bFakeSource, metric: TeamMetric, values: Array<number | null>) {
  controlledFixtures.forEach((item, index) =>
    source.metricValues.set(`${item.id}:${metric}`, values[index] ?? null),
  );
}

async function expectPipelineError(promise: Promise<unknown>, code: string) {
  try {
    await promise;
    throw new Error("expected pipeline error");
  } catch (error) {
    expect(error).toBeInstanceOf(AnalysisPipelineError);
    expect((error as AnalysisPipelineError).code).toBe(code);
  }
}

describe("Phase 5B generic fixture-stat execution", () => {
  test("one snapshot read per fixture is reused by metric and multiple filters", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "possession", [55, 60, 65, 70]);
    setValues(source, "shots", [11, 12, 13, 14]);
    setValues(source, "corners", [4, 5, 6, 7]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "posse com mais de 10 chutes e pelo menos 4 escanteios",
      plan: aggregatePlan({
        metric: "possession",
        filters: [
          { field: "shots", operator: "gt", value: 10 },
          { field: "corners", operator: "gte", value: 4 },
        ],
      }),
      sources: [source],
    });
    expect(result.result_type).toBe("aggregate");
    expect(source.statsReads.sort()).toEqual(["101", "102", "103", "104"]);
    expect(new Set(source.statsReads).size).toBe(4);
    expect(source.legacyMetricCalls).toBe(0);
  });

  test("score filter is applied before fixture_stats reads", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "possession", [55, 60, 65, 70]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "posse nos jogos que venceu",
      plan: aggregatePlan({
        metric: "possession",
        filters: [{ field: "outcome", operator: "eq", value: "win" }],
      }),
      sources: [source],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.statistics.sample_size).toBe(2);
    expect(source.statsReads.sort()).toEqual(["101", "102"]);
  });

  const operatorCases: Array<[string, unknown, number]> = [
    ["eq", 11, 1],
    ["neq", 11, 3],
    ["gt", 11, 2],
    ["gte", 11, 3],
    ["lt", 11, 1],
    ["lte", 11, 2],
    ["in", [10, 12], 2],
  ];
  for (const [operator, value, sample] of operatorCases) {
    test(`generic operator ${operator} executes deterministically`, async () => {
      const source = new Phase5bFakeSource();
      setValues(source, "shots", [10, 11, 12, 13]);
      setValues(source, "corners", [1, 2, 3, 4]);
      const result = await analyzePhase4cUniversalTeamPlanWithSources({
        question: `operator ${operator}`,
        plan: aggregatePlan({
          metric: "corners",
          filters: [{ field: "shots", operator, value }],
        }),
        sources: [source],
      });
      expect(result.result_type).toBe("aggregate");
      if (result.result_type !== "aggregate") return;
      expect(result.statistics.sample_size).toBe(sample);
    });
  }

  test("multiple filters can use metrics different from the aggregate metric", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "shots", [9, 11, 13, 15]);
    setValues(source, "possession", [45, 55, 65, 75]);
    setValues(source, "corners", [1, 2, 3, 4]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "corners after two stat filters",
      plan: aggregatePlan({
        metric: "corners",
        filters: [
          { field: "shots", operator: "gt", value: 10 },
          { field: "possession", operator: "gte", value: 60 },
        ],
      }),
      sources: [source],
    });
    expect(result.result_type).toBe("aggregate");
    if (result.result_type !== "aggregate") return;
    expect(result.statistics.sample_size).toBe(2);
    expect(result.answer.value).toBe(3.5);
  });

  test("UNKNOWN filter value fails closed instead of being treated as zero or false", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "shots", [10, null, 12, 13]);
    setValues(source, "corners", [1, 2, 3, 4]);
    await expectPipelineError(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "unknown filter",
        plan: aggregatePlan({
          metric: "corners",
          filters: [{ field: "shots", operator: "gte", value: 10 }],
        }),
        sources: [source],
      }),
      "DATA_INSUFFICIENT",
    );
  });

  test("UNKNOWN aggregate metric fails closed instead of lowering the sample silently", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "corners", [1, null, 3, 4]);
    await expectPipelineError(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "unknown metric",
        plan: aggregatePlan({ metric: "corners" }),
        sources: [source],
      }),
      "DATA_INSUFFICIENT",
    );
  });

  test("coverage=false for a requested metric fails closed", async () => {
    const source = new Phase5bFakeSource();
    source.getFixtureStats = async (item, teamId) => ({
      snapshot: snapshot({
        provider: "BSD",
        item,
        teamId,
        supported: ["shots"],
        values: { shots: 10 },
      }),
      meta: {
        provider: "BSD",
        endpoint: "/stats",
        dataFamily: "fixture_stats",
        fetchedAt: "2026-08-25T12:00:00.000Z",
        cacheStatus: "hit" as const,
      },
    });
    await expectPipelineError(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "coverage false",
        plan: aggregatePlan({ metric: "corners" }),
        sources: [source],
      }),
      "DATA_INSUFFICIENT",
    );
  });
});

describe("Phase 5B match_list, capability negotiation and provider routing", () => {
  test("match_list outputs the requested metric on every returned match", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "corners", [2, 6, 7, 3]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "liste jogos com 6 escanteios",
      plan: matchListPlan({
        metric: "corners",
        filters: [{ field: "corners", operator: "gte", value: 6 }],
      }),
      sources: [source],
    });
    expect(result.result_type).toBe("match_list");
    if (result.result_type !== "match_list") return;
    expect(result.matches).toHaveLength(2);
    expect(
      result.matches.every((match) => match.metric?.key === "corners" && match.metric.observed),
    ).toBe(true);
    expect(result.matches.map((match) => match.metric?.value)).toEqual([6, 7]);
  });

  test("match_list refuses sort at capability negotiation instead of ignoring it", () => {
    const plan = semantic({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "match_list",
      metric: "possession",
      scope: { venue: "all", half: "full", status: "finished" },
      filters: [],
      group_by: [],
      sort: { field: "value", direction: "desc" },
    });
    const decision = negotiateFootballCapability(plan);
    expect(decision.supported).toBe(false);
    expect(decision.reason).toContain("sort em match_list");
  });

  test("match_list refuses group_by instead of silently ignoring it", () => {
    const plan = semantic({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "match_list",
      metric: "corners",
      scope: { venue: "all", half: "full", status: "finished" },
      filters: [],
      group_by: ["opponent"],
    });
    expect(negotiateFootballCapability(plan).supported).toBe(false);
  });

  test("provider-specific xg negotiates BSD only", () => {
    const decision = negotiateFootballCapability(
      semantic({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "xg",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      }),
    );
    expect(decision.supported).toBe(true);
    expect(decision.providers).toEqual(["BSD"]);
  });

  test("provider-specific saves negotiates API-Football only", () => {
    const decision = negotiateFootballCapability(
      semantic({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "saves",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      }),
    );
    expect(decision.supported).toBe(true);
    expect(decision.providers).toEqual(["API-FOOTBALL"]);
  });

  test("multi-family negotiation identifies score + fixture_stats before execution", () => {
    const decision = negotiateFootballCapability(
      semantic({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "possession",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [{ field: "outcome", operator: "eq", value: "win" }],
        group_by: [],
      }),
    );
    expect(decision.supported).toBe(true);
    expect(new Set(decision.data_families)).toEqual(
      new Set(["fixtures", "fixture_score", "fixture_stats"]),
    );
  });

  test("incompatible provider-specific metric intersection fails before provider execution", () => {
    const decision = negotiateFootballCapability(
      semantic({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "xg",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [{ field: "saves", operator: "gte", value: 1 }],
        group_by: [],
      }),
    );
    expect(decision.supported).toBe(false);
    expect(decision.reason).toContain("nenhum provider");
  });
});

describe("Phase 5B conservative fallback and provenance", () => {
  test("eligible provider data failure falls back conservatively and records attempts", async () => {
    const bsd = new Phase5bFakeSource("BSD");
    bsd.errorOnStats = "DATA_INSUFFICIENT";
    const api = new Phase5bFakeSource("API-FOOTBALL");
    setValues(api, "corners", [1, 2, 3, 4]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "fallback corners",
      plan: aggregatePlan({ metric: "corners" }),
      sources: [bsd, api],
    });
    expect(result.provenance.provider).toBe("API-FOOTBALL");
    expect(result.provenance.providers_attempted).toEqual(["BSD", "API-FOOTBALL"]);
    expect(result.provenance.fallback_occurred).toBe(true);
  });

  test("non-eligible semantic error does not fall back to another provider", async () => {
    const bsd = new Phase5bFakeSource("BSD");
    bsd.errorOnResolve = "UNSUPPORTED_FILTER";
    const api = new Phase5bFakeSource("API-FOOTBALL");
    await expectPipelineError(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "do not fallback",
        plan: aggregatePlan({ metric: "corners" }),
        sources: [bsd, api],
      }),
      "UNSUPPORTED_FILTER",
    );
    expect(api.resolveCalls).toBe(0);
  });

  test("fixture_stats provenance exposes data family, cache and coverage", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "corners", [1, 2, 3, 4]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "provenance",
      plan: aggregatePlan({ metric: "corners" }),
      sources: [source],
    });
    expect(result.provenance.data_families).toContain("fixture_stats");
    expect(result.provenance.cache_status).toBe("hit");
    expect(result.provenance.coverage?.fixtures).toBe(4);
    expect(result.provenance.coverage?.supported).toContain("corners");
    expect(result.provenance.coverage?.observed.corners).toBe(4);
  });

  test("H2H raw fixture_stats uses normalized snapshots and truthful provenance", async () => {
    const source = new Phase5bFakeSource();
    source.metricValues.set("101:corners", 5);
    source.metricValues.set("103:corners", 7);
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      compare_with: { type: "team", name: "Palmeiras" },
      query_kind: "head_to_head",
      metric: "corners",
      aggregation: "average",
      scope: { last_matches: 2, venue: "all", half: "full", status: "finished" },
      filters: [],
      group_by: [],
    });
    const result = await analyzeUniversalQueryPlanWithSources({
      question: "h2h corners",
      plan,
      sources: [source],
    });
    expect(result.result_type).toBe("head_to_head");
    if (result.result_type !== "head_to_head") return;
    expect(result.summary.requested_value).toBe(6);
    expect(result.provenance.data_families).toContain("fixture_stats");
    expect(result.provenance.coverage?.observed.corners).toBe(2);
    expect(source.statsReads.sort()).toEqual(["101", "103"]);
    expect(source.legacyMetricCalls).toBe(0);
  });
});

describe("Phase 5B real competition seasons", () => {
  test("runtime season resolution passes provider IDs and real dates into fixture lookup", async () => {
    const source = new Phase5bFakeSource(
      "BSD",
      controlledFixtures.map((item) => ({ ...item, seasonId: "2026-real" })),
    );
    source.competitionId = "71";
    source.seasonId = "2026-real";
    source.seasonLabel = "2026";
    source.startDate = "2026-02-01";
    source.endDate = "2026-12-10";
    setValues(source, "corners", [1, 2, 3, 4]);
    const result = await analyzePhase4cUniversalTeamPlanWithSources({
      question: "Brasileirão 2026",
      plan: aggregatePlan({
        metric: "corners",
        scope: {
          season: "2026",
          competition: "Brasileirão Série A",
          venue: "all",
          half: "full",
          status: "finished",
        },
      }),
      sources: [source],
    });
    expect(source.seasonReads).toBe(1);
    expect(source.fixtureScopes[0]?.providerCompetitionId).toBe("71");
    expect(source.fixtureScopes[0]?.providerSeasonId).toBe("2026-real");
    expect(source.fixtureScopes[0]?.date_from).toBe("2026-02-01");
    expect(source.fixtureScopes[0]?.date_to).toBe("2026-12-10");
    expect(result.provenance.resolved_season_id).toBe("2026-real");
    expect(result.provenance.data_families).toContain("league_season");
  });

  test("season without explicit competition is rejected at negotiation", () => {
    const decision = negotiateFootballCapability(
      semantic({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "corners",
        aggregation: "average",
        scope: { season: "current", venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      }),
    );
    expect(decision.supported).toBe(false);
    expect(decision.reason).toContain("competição explícita");
  });

  test("provider inability to identify current season fails closed", async () => {
    const source = new Phase5bFakeSource();
    source.seasonCurrent = false;
    setValues(source, "corners", [1, 2, 3, 4]);
    await expectPipelineError(
      analyzePhase4cUniversalTeamPlanWithSources({
        question: "current season unavailable",
        plan: aggregatePlan({
          metric: "corners",
          scope: {
            season: "current",
            competition: "Brasileirão Série A",
            venue: "all",
            half: "full",
            status: "finished",
          },
        }),
        sources: [source],
      }),
      "DATA_INSUFFICIENT",
    );
  });

  test("legacy getFixtureMetric is never used when universal snapshot path exists", async () => {
    const source = new Phase5bFakeSource();
    setValues(source, "shots", [5, 6, 7, 8]);
    await analyzePhase4cUniversalTeamPlanWithSources({
      question: "no legacy",
      plan: aggregatePlan({ metric: "shots" }),
      sources: [source],
    });
    expect(source.legacyMetricCalls).toBe(0);
    expect(source.statsReads).toHaveLength(4);
  });
});
