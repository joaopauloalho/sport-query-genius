import { describe, expect, test } from "bun:test";

import { normalizeTruthfulSemanticCandidate } from "../../src/server/analysis/query-plan-v5a-normalizer";
import {
  createSemanticPlan,
  semanticPlanResponseSchema,
} from "../../src/server/analysis/semantic-plan";
import { negotiateFootballCapability } from "../../src/server/sports/capability-negotiation";
import { runGeniusBenchmark } from "./benchmark";

function semantic(raw: unknown) {
  const normalized = normalizeTruthfulSemanticCandidate(raw);
  const parsed = semanticPlanResponseSchema.parse(normalized);
  if ("error" in parsed) throw new Error("unexpected semantic error");
  return createSemanticPlan(parsed, raw);
}

const base = {
  sport: "football",
  entity: { type: "team", name: "Corinthians" },
  query_kind: "aggregate",
  metric: "goals_for",
  aggregation: "average",
  scope: { venue: "all", half: "full", status: "finished" },
  filters: [],
  group_by: [],
};

describe("Phase 5B truth gate", () => {
  test("benchmark has at least 650 deterministic cases and zero silent semantic loss", () => {
    const report = runGeniusBenchmark();
    expect(report.total).toBeGreaterThanOrEqual(650);
    expect(report.silent_semantic_loss).toBe(0);
    expect(report.semantic_accuracy).toBe(100);
    expect(report.capability_accuracy).toBe(100);
    expect(report.unsupported_rejection_accuracy).toBe(100);
    expect(report.passed).toBe(true);
  });

  test("preserves outcome=win filter", () => {
    const plan = semantic({
      ...base,
      metric: "corners",
      filters: [{ field: "resultado", operator: "eq", value: "venceu" }],
    });
    expect(plan.query.filters).toEqual([{ field: "outcome", operator: "eq", value: "win" }]);
    expect(negotiateFootballCapability(plan).supported).toBe(true);
  });

  test("preserves and executes generic possession > 60 filter", () => {
    const plan = semantic({
      ...base,
      filters: [{ field: "posse", operator: "maior que", value: 60 }],
    });
    expect(plan.query.filters[0]).toMatchObject({
      field: "possession",
      operator: "gt",
      value: 60,
    });
    const decision = negotiateFootballCapability(plan);
    expect(decision.supported).toBe(true);
    expect(decision.data_families).toContain("fixture_stats");
    expect(decision.data_families).toContain("fixture_score");
  });

  test("preserves group_by venue for home-away comparison", () => {
    const plan = semantic({ ...base, group_by: ["casa e fora"] });
    expect(plan.query.group_by).toEqual(["venue"]);
    expect(negotiateFootballCapability(plan).supported).toBe(true);
  });

  test("preserves opponent group, desc sort and limit 5", () => {
    const plan = semantic({
      ...base,
      group_by: ["adversario"],
      sort: { field: "value", direction: "desc" },
      limit: 5,
    });
    expect(plan.query.group_by).toEqual(["opponent"]);
    expect(plan.query.sort).toEqual({ field: "value", direction: "desc" });
    expect(plan.query.limit).toBe(5);
  });

  test("current season fails closed instead of assuming calendar year", () => {
    const plan = semantic({
      ...base,
      entity: { type: "team", name: "Benfica" },
      scope: { season: "current", venue: "all", half: "full", status: "finished" },
    });
    const decision = negotiateFootballCapability(plan);
    expect(decision.supported).toBe(false);
    expect(decision.reason).toContain("CompetitionSeason");
  });

  test("season remains fail-closed even when legacy-compatible dates are present", () => {
    const plan = semantic({
      ...base,
      entity: { type: "team", name: "Benfica" },
      scope: {
        season: "2025/26",
        date_from: "2025-08-01",
        date_to: "2026-05-31",
        venue: "all",
        half: "full",
        status: "finished",
      },
    });
    const decision = negotiateFootballCapability(plan);
    expect(decision.supported).toBe(false);
    expect(decision.reason).toContain("CompetitionSeason");
  });

  test("recognized fixture_stats metric has deterministic universal executor", () => {
    const plan = semantic({ ...base, metric: "possession" });
    const decision = negotiateFootballCapability(plan);
    expect(decision.supported).toBe(true);
    expect(decision.executor).toBe("team_universal_aggregate");
    expect(decision.data_families).toContain("fixture_stats");
  });

  test("unknown filter is preserved instead of becoming filters=[]", () => {
    const plan = semantic({
      ...base,
      filters: [{ field: "pressao alta", operator: "gt", value: 7 }],
    });
    expect(plan.query.filters).toHaveLength(1);
    expect(plan.query.filters[0]?.field).toBe("pressao_alta");
    expect(negotiateFootballCapability(plan).supported).toBe(false);
  });

  test("unknown group_by is preserved instead of becoming group_by=[]", () => {
    const plan = semantic({ ...base, group_by: ["arbitro era"] });
    expect(plan.query.group_by).toEqual(["arbitro_era"]);
    expect(negotiateFootballCapability(plan).supported).toBe(false);
  });
});
