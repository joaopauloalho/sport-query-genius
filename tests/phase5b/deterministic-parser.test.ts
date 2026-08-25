import { describe, expect, test } from "bun:test";

import { parseDeterministicPhase5bTeamQuestion } from "../../src/server/analysis/phase5b-deterministic-parser";

const cases = [
  [
    "Qual a média de posse de bola do Corinthians nos últimos 10 jogos?",
    {
      query_kind: "aggregate",
      entity: "corinthians",
      metric: "possession",
      aggregation: "average",
      last_matches: 10,
      competition: undefined,
      season: undefined,
      filter: undefined,
    },
  ],
  [
    "Qual a média de escanteios do Corinthians nos jogos em que teve mais de 10 chutes?",
    {
      query_kind: "aggregate",
      entity: "corinthians",
      metric: "corners",
      aggregation: "average",
      last_matches: undefined,
      competition: undefined,
      season: undefined,
      filter: { field: "shots", operator: "gt", value: 10 },
    },
  ],
  [
    "Quantos chutes no alvo o Corinthians teve nos jogos em que venceu?",
    {
      query_kind: "aggregate",
      entity: "corinthians",
      metric: "shots_on_target",
      aggregation: "total",
      last_matches: undefined,
      competition: undefined,
      season: undefined,
      filter: { field: "outcome", operator: "eq", value: "win" },
    },
  ],
  [
    "Liste os jogos do Corinthians com pelo menos 6 escanteios.",
    {
      query_kind: "match_list",
      entity: "corinthians",
      metric: "corners",
      aggregation: undefined,
      last_matches: undefined,
      competition: undefined,
      season: undefined,
      filter: { field: "corners", operator: "gte", value: 6 },
    },
  ],
  [
    "Qual a média de posse do Benfica na Champions League 2025/26?",
    {
      query_kind: "aggregate",
      entity: "benfica",
      metric: "possession",
      aggregation: "average",
      last_matches: undefined,
      competition: "UEFA Champions League",
      season: "2025/26",
      filter: undefined,
    },
  ],
  [
    "Mostre os jogos do Arsenal na Premier League 2025/26 com pelo menos 4 chutes no alvo.",
    {
      query_kind: "match_list",
      entity: "arsenal",
      metric: "shots_on_target",
      aggregation: undefined,
      last_matches: undefined,
      competition: "Premier League",
      season: "2025/26",
      filter: { field: "shots_on_target", operator: "gte", value: 4 },
    },
  ],
] as const;

describe("Phase 5B deterministic production grammar", () => {
  for (const [question, expected] of cases) {
    test(question, () => {
      const plan = parseDeterministicPhase5bTeamQuestion(question);
      expect(plan).not.toBeNull();
      if (!plan) return;
      expect(plan.query_kind).toBe(expected.query_kind);
      expect(plan.entity.name).toBe(expected.entity);
      expect(plan.metric).toBe(expected.metric);
      expect(plan.aggregation).toBe(expected.aggregation);
      expect(plan.scope.last_matches).toBe(expected.last_matches);
      expect(plan.scope.competition).toBe(expected.competition);
      expect(plan.scope.season).toBe(expected.season);
      expect(plan.filters[0]).toEqual(expected.filter);
    });
  }

  test("does not silently simplify a question with an extra unsupported constraint", () => {
    expect(
      parseDeterministicPhase5bTeamQuestion(
        "Qual a média de posse do Corinthians nos últimos 10 jogos aos domingos?",
      ),
    ).toBeNull();
  });
});
