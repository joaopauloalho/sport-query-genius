import { describe, expect, test } from "bun:test";

import { queryPlanSchema } from "../../src/server/analysis/query-plan";
import {
  FOOTBALL_CACHE_FAMILIES,
  getRegisteredCapability,
  resolveFootballCapability,
} from "../../src/server/sports/capability-registry";

describe("Phase 4A/4B football capability registry", () => {
  test("marks the preserved team corners engine as implemented", () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "aggregate",
      metric: "corners",
      aggregation: "average",
      scope: { last_matches: 5, venue: "all", half: "full" },
    });
    const resolution = resolveFootballCapability(plan);

    expect(resolution.supported).toBe(true);
    expect(resolution.stage).toBe("implemented");
    expect(resolution.sources.some((item) => item.provider === "BSD")).toBe(true);
    expect(resolution.sources.some((item) => item.provider === "API_FOOTBALL")).toBe(true);
  });

  test("recognizes provider-backed xG but refuses to pretend the executor is ready", () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "aggregate",
      metric: "xg",
      aggregation: "average",
      scope: { last_matches: 5, venue: "all", half: "full" },
    });
    const resolution = resolveFootballCapability(plan);

    expect(resolution.supported).toBe(true);
    expect(resolution.stage).toBe("planned");
    expect(resolution.sources.some((item) => item.provider === "BSD")).toBe(true);
  });

  test("registers team standings independently from competition rankings", () => {
    expect(getRegisteredCapability("team", "standings")?.cacheFamily).toBe("standings");
    expect(getRegisteredCapability("competition", "ranking")?.cacheFamily).toBe("standings");
  });

  test("routes implemented team events to BSD first and API-Football as fallback", () => {
    const plan = queryPlanSchema.parse({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "event_list",
      event_type: "yellow_card",
      scope: { last_matches: 5, venue: "all", half: "full" },
    });
    const resolution = resolveFootballCapability(plan);

    expect(resolution.stage).toBe("implemented");
    expect(resolution.sources[0]?.provider).toBe("BSD");
    expect(resolution.sources[0]?.fallback).toBe(false);
    expect(resolution.sources[1]?.provider).toBe("API_FOOTBALL");
    expect(resolution.sources[1]?.fallback).toBe(true);
  });

  test("keeps optional paid BSD features out of the required live path", () => {
    const live = getRegisteredCapability("match", "live_status");
    expect(live?.sources.some((item) => item.paidAddonRequired)).toBe(false);
    expect(live?.note).toContain("REST");
  });

  test("exposes cache policies per data family", () => {
    expect(FOOTBALL_CACHE_FAMILIES.standings.ttlMs).toBe(10 * 60_000);
    expect(FOOTBALL_CACHE_FAMILIES.team_stats.ttlMs).toBe(10 * 60_000);
    expect(FOOTBALL_CACHE_FAMILIES.transfers.ttlMs).toBe(24 * 60 * 60_000);
    expect(FOOTBALL_CACHE_FAMILIES.live.ttlMs).toBeLessThan(
      FOOTBALL_CACHE_FAMILIES.fixtures.ttlMs,
    );
    expect(FOOTBALL_CACHE_FAMILIES.odds.providerFreshnessPreferred).toBe(true);
  });
});
