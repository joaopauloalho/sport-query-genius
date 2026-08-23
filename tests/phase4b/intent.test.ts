import { describe, expect, test } from "bun:test";

import { queryPlanSchema, queryPlanSignature } from "../../src/server/analysis/query-plan";
import { normalizeQueryPlanCandidate } from "../../src/server/analysis/query-plan-normalizer";

const normalize = (raw: Record<string, unknown>) =>
  queryPlanSchema.parse(normalizeQueryPlanCandidate(raw));

describe("Phase 4B offline intent normalization", () => {
  test("three PT-BR goal-event paraphrase candidates become the same semantic QueryPlan", () => {
    const candidates = [
      {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "event_list",
        event_type: "goal",
        scope: { last_matches: 5 },
      },
      {
        sport: "futebol",
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "events",
        event_type: "gol",
        match_count: "5",
      },
      {
        sport: "soccer",
        entity: { type: "equipe", name: "Corinthians" },
        query_kind: "lista de eventos",
        event_type: "gols",
        scope: { last_matches: 5 },
      },
    ];
    const signatures = candidates.map((candidate) => queryPlanSignature(normalize(candidate)));
    expect(new Set(signatures).size).toBe(1);
  });

  test("event synonyms normalize to canonical team event types", () => {
    const cases = [
      ["gol", "goal"],
      ["gols", "goal"],
      ["assistencia", "assist"],
      ["assistência", "assist"],
      ["amarelo", "yellow_card"],
      ["cartao amarelo", "yellow_card"],
      ["vermelho", "red_card"],
      ["expulsao", "red_card"],
      ["substituicao", "substitution"],
      ["var", "var"],
      ["penalti", "penalty"],
    ] as const;

    for (const [rawEvent, canonical] of cases) {
      const plan = normalize({
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "event_list",
        event_type: rawEvent,
        match_count: 5,
      });
      expect(plan.event_type, rawEvent).toBe(canonical);
    }
  });

  test("match-list and schedule candidates converge to structural kinds", () => {
    const lastGames = normalize({
      entity_type: "time",
      entity_name: "Corinthians",
      query_kind: "matches",
      match_count: 5,
      status: "finalizado",
    });
    const schedule = normalize({
      entity_type: "equipe",
      entity_name: "Corinthians",
      query_kind: "agenda",
      match_count: 5,
      status: "proximo",
    });

    expect(lastGames.query_kind).toBe("match_list");
    expect(lastGames.scope.last_matches).toBe(5);
    expect(lastGames.scope.status).toBe("finished");
    expect(schedule.query_kind).toBe("schedule");
    expect(schedule.scope.last_matches).toBe(5);
    expect(schedule.scope.status).toBe("upcoming");
  });

  test("H2H always carries two team entities and a comparable window", () => {
    const cases = [
      {
        entity: { type: "team", name: "Corinthians" },
        query_kind: "head_to_head",
        compare_with: { type: "team", name: "Palmeiras" },
        scope: { last_matches: 5 },
      },
      {
        entity_type: "time",
        entity_name: "Corinthians",
        query_kind: "confrontos",
        compare_with: { type: "time", name: "Palmeiras" },
        match_count: 5,
      },
    ];
    const plans = cases.map((candidate) => normalize(candidate));
    for (const plan of plans) {
      expect(plan.query_kind).toBe("head_to_head");
      expect(plan.entity.type).toBe("team");
      expect(plan.compare_with?.type).toBe("team");
      expect(plan.compare_with?.name).toBe("Palmeiras");
      expect(plan.scope.last_matches).toBe(5);
    }
  });

  test("last N events remains different from events inside last N matches", () => {
    const lastEvents = normalize({
      entity_type: "time",
      entity_name: "Corinthians",
      query_kind: "event_list",
      event_type: "goal",
      event_count: 5,
    });
    const inMatches = normalize({
      entity_type: "time",
      entity_name: "Corinthians",
      query_kind: "event_list",
      event_type: "goal",
      match_count: 5,
    });

    expect(lastEvents.scope.limit).toBe(5);
    expect(lastEvents.scope.last_matches).toBeUndefined();
    expect(inMatches.scope.last_matches).toBe(5);
    expect(inMatches.scope.limit).toBeUndefined();
  });

  test("universal filters stay structural", () => {
    const plan = normalize({
      entity_type: "time",
      entity_name: "Corinthians",
      query_kind: "match_list",
      match_count: 10,
      venue: "casa",
      competition: "Brasileirão",
      opponent: "Palmeiras",
      status: "finished",
    });

    expect(plan.scope).toMatchObject({
      last_matches: 10,
      venue: "home",
      competition: "Brasileirão",
      opponent: "Palmeiras",
      status: "finished",
    });
  });
});
