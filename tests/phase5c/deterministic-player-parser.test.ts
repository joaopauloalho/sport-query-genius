import { describe, expect, test } from "bun:test";

import { parseUniversalSemanticPlanWithDeepSeek } from "../../src/server/analysis/deepseek-v5a.server";
import { parseDeterministicPhase5cPlayerQuestion } from "../../src/server/analysis/phase5c-deterministic-player-parser";
import {
  PHASE5C_NATURAL_LANGUAGE_CASES,
  PHASE5C_NATURAL_LANGUAGE_NEGATIVES,
  runPhase5cNaturalLanguageBenchmark,
} from "../genius/phase5c-natural-language-benchmark";

describe("Phase 5C deterministic player production grammar", () => {
  test("regression: production Yuri passes question becomes a complete SemanticPlan", () => {
    expect(
      parseDeterministicPhase5cPlayerQuestion(
        "Qual foi a média de passes do Yuri Alberto nos últimos 10 jogos?",
      ),
    ).toEqual({
      sport: "football",
      entity: { type: "player", name: "Yuri Alberto" },
      query_kind: "aggregate",
      metric: "passes",
      aggregation: "average",
      scope: {
        last_matches: 10,
        venue: "all",
        half: "full",
        status: "finished",
      },
      filters: [],
      group_by: [],
    });
  });

  test("the production entrypoint bypasses DeepSeek for the regression question", async () => {
    const previousKey = process.env.DEEPSEEK_API_KEY;
    delete process.env.DEEPSEEK_API_KEY;
    try {
      const semantic = await parseUniversalSemanticPlanWithDeepSeek(
        "Qual foi a média de passes do Yuri Alberto nos últimos 10 jogos?",
      );
      expect(semantic.query.entity).toEqual({ type: "player", name: "Yuri Alberto" });
      expect(semantic.query.metric).toBe("passes");
      expect(semantic.query.aggregation).toBe("average");
      expect(semantic.query.scope.last_matches).toBe(10);
      expect(semantic.preservation_issues).toEqual([]);
    } finally {
      if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previousKey;
    }
  });

  for (const testCase of PHASE5C_NATURAL_LANGUAGE_CASES) {
    test(`natural language contract: ${testCase.id}`, () => {
      expect(parseDeterministicPhase5cPlayerQuestion(testCase.question)).not.toBeNull();
    });
  }

  for (const question of PHASE5C_NATURAL_LANGUAGE_NEGATIVES) {
    test(`fail closed: ${question}`, () => {
      expect(parseDeterministicPhase5cPlayerQuestion(question)).toBeNull();
    });
  }

  test("natural-language benchmark has zero silent semantic loss", () => {
    const report = runPhase5cNaturalLanguageBenchmark();
    expect(report.total).toBe(25);
    expect(report.semantic_accuracy).toBe(100);
    expect(report.negative_rejection_accuracy).toBe(100);
    expect(report.silent_semantic_loss).toBe(0);
    expect(report.failures).toEqual([]);
    expect(report.passed).toBe(true);
  });
});
