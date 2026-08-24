import { describe, expect, test } from "bun:test";

import {
  MAX_QUERY_MATCHES,
  queryPlanSchema,
  queryPlanSignature,
} from "../../src/server/analysis/query-plan";
import { normalizeUniversalQueryPlanCandidate } from "../../src/server/analysis/query-plan-v4c-normalizer";

describe("Phase 4C universal QueryPlan", () => {
  test("accepts arbitrary reasonable last-match windows instead of a fixed preset list", () => {
    for (const lastMatches of [7, 12, 25, 30, 38, 50, 100]) {
      const parsed = queryPlanSchema.parse({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "corners",
        aggregation: "average",
        scope: { last_matches: lastMatches, venue: "all", half: "full" },
      });
      expect(parsed.scope.last_matches).toBe(lastMatches);
    }
    expect(MAX_QUERY_MATCHES).toBe(100);
    expect(
      queryPlanSchema.safeParse({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_against",
        aggregation: "average",
        scope: { last_matches: 101, venue: "all", half: "full" },
      }).success,
    ).toBe(false);
  });

  test("competition and season scope does not invent last_matches", () => {
    const normalized = normalizeUniversalQueryPlanCandidate({
      sport: "futebol",
      entity_type: "time",
      entity_name: "Corinthians",
      query_kind: "agregado",
      metric: "gols sofridos",
      aggregation: "media",
      competition: "Brasileirão",
      season: "2026",
      venue: "mandante",
    });
    const parsed = queryPlanSchema.parse(normalized);
    expect(parsed.entity.type).toBe("team");
    expect(parsed.metric).toBe("goals_against");
    expect(parsed.aggregation).toBe("average");
    expect(parsed.scope.competition).toBe("Brasileirão Série A");
    expect(parsed.scope.season).toBe("2026");
    expect(parsed.scope.venue).toBe("home");
    expect(parsed.scope.last_matches).toBeUndefined();
  });

  test("normalizes structured filters without arbitrary expressions", () => {
    const parsed = queryPlanSchema.parse(
      normalizeUniversalQueryPlanCandidate({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "aggregate",
        metric: "escanteios",
        aggregation: "media",
        filters: [{ field: "resultado", operator: "igual", value: "vitória" }],
      }),
    );
    expect(parsed.filters).toEqual([{ field: "outcome", operator: "eq", value: "win" }]);

    const atLeastTwo = queryPlanSchema.parse(
      normalizeUniversalQueryPlanCandidate({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "match_list",
        filters: [{ field: "gols sofridos", operator: ">=", value: "2" }],
      }),
    );
    expect(atLeastTwo.filters).toEqual([{ field: "goals_against", operator: "gte", value: 2 }]);
  });

  test("group_by venue and presentation limit are independent from scope.last_matches", () => {
    const parsed = queryPlanSchema.parse(
      normalizeUniversalQueryPlanCandidate({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "aggregate",
        metric: "gols sofridos",
        aggregation: "media",
        competition: "Brasileirão",
        season: 2026,
        group_by: ["mando"],
        sort: { field: "value", direction: "desc" },
        limit: 2,
      }),
    );
    expect(parsed.group_by).toEqual(["venue"]);
    expect(parsed.sort).toEqual({ field: "value", direction: "desc" });
    expect(parsed.limit).toBe(2);
    expect(parsed.scope.last_matches).toBeUndefined();
  });

  test("aproveitamento is normalized to points percentage, distinct from win rate", () => {
    const efficiency = queryPlanSchema.parse(
      normalizeUniversalQueryPlanCandidate({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "aggregate",
        metric: "aproveitamento",
        aggregation: "porcentagem",
        season: 2026,
      }),
    );
    expect(efficiency.metric).toBe("points");
    expect(efficiency.aggregation).toBe("percentage");
  });

  test("paraphrase candidates converge to the same semantic signature", () => {
    const candidates = [
      {
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "aggregate",
        metric: "gols sofridos",
        aggregation: "media",
        competition: "Brasileirão",
        season: "2026",
        venue: "casa",
      },
      {
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "gols tomados",
        aggregation: "average",
        scope: { competition: "Campeonato Brasileiro Série A", season: 2026, venue: "home" },
      },
      {
        sport: "soccer",
        entity: { type: "equipe", name: "Corinthians" },
        query_kind: "agregado",
        metric: "gols levados",
        aggregation: "média",
        scope: { competition: "brasileirao", season: "2026", venue: "mandante" },
      },
    ];
    const signatures = candidates.map((candidate) =>
      queryPlanSignature(queryPlanSchema.parse(normalizeUniversalQueryPlanCandidate(candidate))),
    );
    expect(new Set(signatures).size).toBe(1);
  });

  test("streak and distribution are structurally representable but not faked", () => {
    const streak = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "streak",
      metric: "unbeaten_rate",
      scope: { season: "2026", venue: "all", half: "full" },
    });
    const distribution = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "distribution",
      metric: "goals_for",
      scope: { season: "2026", venue: "all", half: "full" },
    });
    expect(streak.query_kind).toBe("streak");
    expect(distribution.query_kind).toBe("distribution");
  });
});
