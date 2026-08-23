import { describe, expect, test } from "bun:test";

import {
  queryPlanSchema,
  queryPlanSignature,
} from "../../src/server/analysis/query-plan";
import { normalizeQueryPlanCandidate } from "../../src/server/analysis/query-plan-normalizer";

type BankEntry = {
  question: string;
  raw: Record<string, unknown>;
  expected: {
    entityType: string;
    queryKind: string;
    metric?: string;
    aggregation?: string;
    lastMatches?: number;
  };
};

const teams = ["Corinthians", "Palmeiras", "Flamengo", "São Paulo"] as const;
const metricCases = [
  { phrase: "escanteios", raw: "cantos", canonical: "corners" },
  { phrase: "finalizações", raw: "arremates", canonical: "shots" },
  { phrase: "finalizações no alvo", raw: "chutes certos", canonical: "shots_on_target" },
  { phrase: "gols marcados", raw: "gols", canonical: "goals_for" },
  { phrase: "gols sofridos", raw: "gols sofridos", canonical: "goals_against" },
  { phrase: "posse de bola", raw: "posse de bola", canonical: "possession" },
  { phrase: "passes certos", raw: "passes completos", canonical: "accurate_passes" },
  { phrase: "desarmes", raw: "desarmes", canonical: "tackles" },
  { phrase: "cartões amarelos", raw: "amarelos", canonical: "yellow_cards" },
] as const;
const aggregationCases = [
  { phrase: "média", raw: "media", canonical: "average" },
  { phrase: "total", raw: "soma", canonical: "total" },
  { phrase: "mediana", raw: "mediana", canonical: "median" },
  { phrase: "maior número", raw: "maior", canonical: "maximum" },
  { phrase: "menor número", raw: "menor", canonical: "minimum" },
] as const;
const windows = [1, 3, 5, 10] as const;

const intentBank: BankEntry[] = [];
for (const team of teams) {
  for (const metric of metricCases) {
    for (const aggregation of aggregationCases) {
      for (const lastMatches of windows) {
        intentBank.push({
          question: `Qual o ${aggregation.phrase} de ${metric.phrase} do ${team} nos últimos ${lastMatches} jogos?`,
          raw: {
            sport: "futebol",
            entity_type: "time",
            entity_name: team,
            query_kind: "agregado",
            metric: metric.raw,
            aggregation: aggregation.raw,
            match_count: String(lastMatches),
            venue: "todos",
          },
          expected: {
            entityType: "team",
            queryKind: "aggregate",
            metric: metric.canonical,
            aggregation: aggregation.canonical,
            lastMatches,
          },
        });
      }
    }
  }
}

describe("Phase 4A universal QueryPlan", () => {
  test("intent bank contains at least 150 distinct PT-BR questions", () => {
    expect(intentBank.length).toBeGreaterThanOrEqual(150);
    expect(new Set(intentBank.map((entry) => entry.question)).size).toBe(intentBank.length);
  });

  test("normalizes the full PT-BR intent bank into strict QueryPlans", () => {
    for (const entry of intentBank) {
      const normalized = normalizeQueryPlanCandidate(entry.raw);
      const parsed = queryPlanSchema.safeParse(normalized);
      expect(parsed.success, entry.question).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.entity.type).toBe(entry.expected.entityType);
      expect(parsed.data.query_kind).toBe(entry.expected.queryKind);
      expect(parsed.data.metric).toBe(entry.expected.metric);
      expect(parsed.data.aggregation).toBe(entry.expected.aggregation);
      expect(parsed.data.scope.last_matches).toBe(entry.expected.lastMatches);
      expect(parsed.data.scope.venue).toBe("all");
      expect(parsed.data.scope.half).toBe("full");
    }
  });

  test("normalizes player goals independently from team goals", () => {
    const player = queryPlanSchema.parse(
      normalizeQueryPlanCandidate({
        sport: "futebol",
        entity_type: "jogador",
        entity_name: "Yuri Alberto",
        query_kind: "aggregate",
        metric: "gols",
        aggregation: "total",
        match_count: 10,
      }),
    );
    const team = queryPlanSchema.parse(
      normalizeQueryPlanCandidate({
        sport: "futebol",
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "aggregate",
        metric: "gols",
        aggregation: "total",
        match_count: 10,
      }),
    );

    expect(player.metric).toBe("goals");
    expect(team.metric).toBe("goals_for");
  });

  test("paraphrases of team goal events produce the same semantic signature", () => {
    const candidates = [
      {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "event_list",
        event_type: "goal",
        scope: { last_matches: 5, venue: "all", half: "full" },
      },
      {
        sport: "futebol",
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "events",
        event_type: "gol",
        match_count: "5",
        venue: "todos",
      },
      {
        sport: "soccer",
        entity: { type: "equipe", name: "Corinthians" },
        query_kind: "lista de eventos",
        event_type: "gols",
        scope: { last_matches: 5 },
      },
    ];
    const plans = candidates.map((candidate) =>
      queryPlanSchema.parse(normalizeQueryPlanCandidate(candidate)),
    );
    const signatures = plans.map(queryPlanSignature);
    expect(new Set(signatures).size).toBe(1);
  });

  test("distinguishes last N events from events inside last N matches", () => {
    const lastGoals = queryPlanSchema.parse(
      normalizeQueryPlanCandidate({
        entity_type: "jogador",
        entity_name: "Yuri Alberto",
        query_kind: "event_list",
        event_type: "gol",
        event_count: 5,
      }),
    );
    const goalsInMatches = queryPlanSchema.parse(
      normalizeQueryPlanCandidate({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "event_list",
        event_type: "gol",
        match_count: 5,
      }),
    );

    expect(lastGoals.scope.limit).toBe(5);
    expect(lastGoals.scope.last_matches).toBeUndefined();
    expect(goalsInMatches.scope.last_matches).toBe(5);
    expect(goalsInMatches.scope.limit).toBeUndefined();
  });

  test("rejects invalid structural combinations", () => {
    expect(
      queryPlanSchema.safeParse({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        scope: { venue: "all", half: "full" },
      }).success,
    ).toBe(false);

    expect(
      queryPlanSchema.safeParse({
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "comparison",
        metric: "corners",
        scope: { last_matches: 5, venue: "all", half: "full" },
      }).success,
    ).toBe(false);
  });
});
