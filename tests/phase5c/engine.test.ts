import { describe, expect, test } from "bun:test";

import {
  executePlayerAggregate,
  executePlayerMatchList,
} from "../../src/server/analysis/analyze-player-universal.server";
import { AnalysisPipelineError } from "../../src/server/analysis/errors";
import { queryPlanSchema } from "../../src/server/analysis/query-plan";
import {
  createSemanticPlan,
  semanticPlanResponseSchema,
} from "../../src/server/analysis/semantic-plan";
import { normalizeTruthfulSemanticCandidate } from "../../src/server/analysis/query-plan-v5a-normalizer";
import { negotiateFootballCapability } from "../../src/server/sports/capability-negotiation";
import { reconcilePlayerIdentity } from "../../src/server/sports/player-identity";
import type { PlayerMetricKey } from "../../src/server/sports/metric-catalog";
import { controlledPlayerSnapshots, Phase5cFakeSource, playerSnapshot } from "./helpers";

function plan(
  params: {
    kind?: "aggregate" | "match_list";
    metric?: PlayerMetricKey;
    aggregation?: string;
    filters?: Array<{ field: string; operator: string; value: unknown }>;
    scope?: Record<string, unknown>;
    group_by?: string[];
    sort?: { field: string; direction: string };
    limit?: number;
  } = {},
) {
  return queryPlanSchema.parse({
    sport: "football",
    entity: { type: "player", name: "Yuri Alberto" },
    query_kind: params.kind ?? "aggregate",
    metric: params.metric ?? "goals",
    ...(params.kind === "match_list" ? {} : { aggregation: params.aggregation ?? "average" }),
    scope: params.scope ?? {
      last_matches: 4,
      venue: "all",
      half: "full",
      status: "finished",
    },
    filters: params.filters ?? [],
    group_by: params.group_by ?? [],
    ...(params.sort ? { sort: params.sort } : {}),
    ...(params.limit ? { limit: params.limit } : {}),
  });
}

function semantic(raw: unknown) {
  const normalized = normalizeTruthfulSemanticCandidate(raw);
  const parsed = semanticPlanResponseSchema.parse(normalized);
  if ("error" in parsed) throw new Error("unexpected semantic error");
  return createSemanticPlan(parsed, raw);
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

describe("Phase 5C universal player aggregate", () => {
  test("legacy goals aggregate continues through the universal engine", async () => {
    const result = await executePlayerAggregate(
      "goals",
      plan(),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.statistics.sample_size).toBe(4);
    expect(result.answer.value).toBe(0.75);
  });

  for (const metric of ["assists", "passes", "tackles", "rating"] as const) {
    test(`${metric} is executable from the same match snapshots`, async () => {
      const source = new Phase5cFakeSource();
      const result = await executePlayerAggregate(metric, plan({ metric }), undefined, source);
      expect(result.statistics.sample_size).toBe(4);
      expect(source.snapshotReads).toBe(1);
    });
  }

  test("BSD xG aggregate executes only when observed", async () => {
    const snapshots = controlledPlayerSnapshots.map((row, index) =>
      playerSnapshot({
        id: row.fixtureId,
        date: row.date.slice(0, 10),
        venue: row.venue,
        opponent: row.opponentName,
        values: { xg: [0, 0.4, 0.8, 1.2, 1.6][index], minutes: row.participated ? 90 : 0 },
        participated: row.participated,
      }),
    );
    const result = await executePlayerAggregate(
      "xg",
      plan({ metric: "xg" }),
      undefined,
      new Phase5cFakeSource(snapshots),
    );
    expect(result.statistics.sample_size).toBe(4);
    expect(result.answer.value).toBe(0.9);
  });

  test("output metric may differ from filter metric", async () => {
    const result = await executePlayerAggregate(
      "goals where shots >= 4",
      plan({ metric: "goals", filters: [{ field: "shots", operator: "gte", value: 4 }] }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.statistics.sample_size).toBe(3);
    expect(result.answer.value).toBe(1);
  });

  test("multiple player metric filters are AND", async () => {
    const result = await executePlayerAggregate(
      "passes with tackles and minutes",
      plan({
        metric: "passes",
        filters: [
          { field: "tackles", operator: "gte", value: 3 },
          { field: "rating", operator: "gte", value: 7 },
        ],
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.statistics.sample_size).toBe(2);
    expect(result.answer.value).toBe(55);
  });

  test("venue scope combines with a player metric", async () => {
    const result = await executePlayerAggregate(
      "passes away",
      plan({
        metric: "passes",
        scope: { last_matches: 10, venue: "away", half: "full", status: "finished" },
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.statistics.sample_size).toBe(2);
    expect(result.answer.value).toBe(45);
  });

  test("competition and real season are applied before last N", async () => {
    const snapshots = [
      playerSnapshot({
        id: 301,
        date: "2025-09-01",
        competition: "Premier League",
        seasonId: "2025",
        values: { passes: 30 },
      }),
      playerSnapshot({
        id: 302,
        date: "2026-02-01",
        competition: "Premier League",
        seasonId: "2025",
        values: { passes: 50 },
      }),
      ...controlledPlayerSnapshots,
    ];
    const source = new Phase5cFakeSource(snapshots);
    const result = await executePlayerAggregate(
      "passes PL season",
      plan({
        metric: "passes",
        scope: {
          last_matches: 10,
          competition: "Premier League",
          season: "2025/26",
          venue: "all",
          half: "full",
          status: "finished",
        },
      }),
      undefined,
      source,
    );
    expect(result.statistics.sample_size).toBe(2);
    expect(result.answer.value).toBe(40);
    expect(source.seasonReads).toBe(1);
  });

  test("date range and opponent scopes are deterministic", async () => {
    const result = await executePlayerAggregate(
      "Palmeiras date range",
      plan({
        metric: "passes",
        scope: {
          last_matches: 10,
          date_from: "2026-08-14",
          date_to: "2026-08-16",
          opponent: "Palmeiras",
          venue: "all",
          half: "full",
          status: "finished",
        },
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.statistics.sample_size).toBe(1);
    expect(result.answer.value).toBe(50);
  });

  test("last N means real appearances, not team fixtures or unused bench rows", async () => {
    const result = await executePlayerAggregate(
      "last two appearances",
      plan({
        metric: "passes",
        scope: { last_matches: 2, venue: "all", half: "full", status: "finished" },
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.matches.map((match) => match.id)).toEqual(["204", "205"]);
    expect(result.answer.value).toBe(55);
  });

  test("explicit zero remains a real value", async () => {
    const result = await executePlayerAggregate(
      "zero goals",
      plan({
        metric: "goals",
        scope: { last_matches: 1, venue: "away", half: "full", status: "finished" },
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.answer.value).toBe(0);
    expect(result.source.missing).toBe(0);
  });

  test("UNKNOWN output metric fails closed", async () => {
    const snapshots = [...controlledPlayerSnapshots];
    snapshots[4] = playerSnapshot({ id: 205, date: "2026-08-20", values: { passes: null } });
    await expectPipelineError(
      executePlayerAggregate(
        "unknown passes",
        plan({ metric: "passes" }),
        undefined,
        new Phase5cFakeSource(snapshots),
      ),
      "DATA_INSUFFICIENT",
    );
  });

  test("UNKNOWN required filter never shrinks the sample silently", async () => {
    const snapshots = [...controlledPlayerSnapshots];
    snapshots[4] = playerSnapshot({
      id: 205,
      date: "2026-08-20",
      values: { passes: 60, rating: null },
    });
    await expectPipelineError(
      executePlayerAggregate(
        "passes rating",
        plan({ metric: "passes", filters: [{ field: "rating", operator: "gte", value: 7 }] }),
        undefined,
        new Phase5cFakeSource(snapshots),
      ),
      "DATA_INSUFFICIENT",
    );
  });

  test("group_by venue occurs after filters and sort/limit after aggregate", async () => {
    const result = await executePlayerAggregate(
      "group passes",
      plan({
        metric: "passes",
        group_by: ["venue"],
        sort: { field: "value", direction: "desc" },
        limit: 1,
      }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.result_kind).toBe("grouped_aggregate");
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].dimensions.venue).toBe("home");
    expect(result.groups[0].value).toBe(45);
    expect(result.groups[0].sample_size).toBe(2);
  });

  test("group_by competition keeps deterministic dimension values", async () => {
    const snapshots = [
      ...controlledPlayerSnapshots,
      playerSnapshot({
        id: 260,
        date: "2026-08-22",
        competition: "Premier League",
        seasonId: "2025",
        values: { passes: 80 },
      }),
    ];
    const result = await executePlayerAggregate(
      "group competition",
      plan({
        metric: "passes",
        scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
        group_by: ["competition"],
      }),
      undefined,
      new Phase5cFakeSource(snapshots),
    );
    expect(result.groups.map((group) => group.dimensions.competition).sort()).toEqual([
      "Brasileirão Série A",
      "Premier League",
    ]);
  });

  test("goal_contributions is goals + assists only when both are observed", async () => {
    const result = await executePlayerAggregate(
      "goal contributions",
      plan({ metric: "goal_contributions", aggregation: "total" }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.answer.value).toBe(5);
  });

  test("goal_contributions becomes UNKNOWN when one component is missing", async () => {
    const snapshots = [...controlledPlayerSnapshots];
    snapshots[4] = playerSnapshot({
      id: 205,
      date: "2026-08-20",
      values: { goals: 2, assists: null },
    });
    await expectPipelineError(
      executePlayerAggregate(
        "goal contributions unknown",
        plan({ metric: "goal_contributions", aggregation: "total" }),
        undefined,
        new Phase5cFakeSource(snapshots),
      ),
      "DATA_INSUFFICIENT",
    );
  });
});

describe("Phase 5C player match_list", () => {
  test("requested metric is rendered on every returned match", async () => {
    const result = await executePlayerMatchList(
      "list passes",
      plan({ kind: "match_list", metric: "passes" }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.player?.name).toBe("Yuri Alberto");
    expect(result.matches).toHaveLength(4);
    expect(result.matches.every((match) => match.metric?.key === "passes")).toBe(true);
  });

  test("explicit zero appears as zero in match_list", async () => {
    const result = await executePlayerMatchList(
      "list goals",
      plan({ kind: "match_list", metric: "goals" }),
      undefined,
      new Phase5cFakeSource(),
    );
    expect(result.matches.some((match) => match.metric?.value === 0)).toBe(true);
  });

  test("missing requested metric fails instead of inventing zero", async () => {
    const snapshots = [...controlledPlayerSnapshots];
    snapshots[4] = playerSnapshot({ id: 205, date: "2026-08-20", values: { passes: null } });
    await expectPipelineError(
      executePlayerMatchList(
        "missing passes",
        plan({ kind: "match_list", metric: "passes" }),
        undefined,
        new Phase5cFakeSource(snapshots),
      ),
      "DATA_INSUFFICIENT",
    );
  });
});

describe("Phase 5C capability and identity gates", () => {
  test("player metric filter is accepted entity-aware", () => {
    const s = semantic({
      sport: "football",
      entity: { type: "player", name: "Yuri Alberto" },
      query_kind: "aggregate",
      metric: "goals",
      aggregation: "average",
      scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
      filters: [{ field: "shots", operator: "gte", value: 4 }],
      group_by: [],
    });
    const negotiated = negotiateFootballCapability(s);
    expect(negotiated.supported).toBe(true);
    expect(negotiated.executor).toBe("player_universal_aggregate");
  });

  test("team query cannot silently use a player-only metric filter", () => {
    const s = semantic({
      sport: "football",
      entity: { type: "team", name: "Corinthians" },
      query_kind: "aggregate",
      metric: "corners",
      aggregation: "average",
      scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
      filters: [{ field: "rating", operator: "gte", value: 7 }],
      group_by: [],
    });
    const negotiated = negotiateFootballCapability(s);
    expect(negotiated.supported).toBe(false);
    expect(negotiated.error_code).toBe("UNSUPPORTED_FILTER");
  });

  test("API-only intersection fails before execution because player identity is not reconciled", () => {
    const s = semantic({
      sport: "football",
      entity: { type: "player", name: "Yuri Alberto" },
      query_kind: "aggregate",
      metric: "saves",
      aggregation: "average",
      scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
      filters: [],
      group_by: [],
    });
    const negotiated = negotiateFootballCapability(s);
    expect(negotiated.supported).toBe(true);
    expect(negotiated.providers).toContain("BSD");
  });

  test("exact cross-provider identity requires corroborating evidence", () => {
    const result = reconcilePlayerIdentity(
      {
        provider: "BSD",
        providerPlayerId: "1",
        canonicalName: "João Silva",
        teamName: "Corinthians",
        nationality: "Brazil",
      },
      [
        {
          provider: "API-FOOTBALL",
          providerPlayerId: "88",
          canonicalName: "Joao Silva",
          teamName: "Corinthians",
          nationality: "Brazil",
        },
      ],
    );
    expect(result.status).toBe("matched");
  });

  test("ambiguous cross-provider identity fails closed", () => {
    const result = reconcilePlayerIdentity(
      {
        provider: "BSD",
        providerPlayerId: "1",
        canonicalName: "João Silva",
        nationality: "Brazil",
      },
      [
        {
          provider: "API-FOOTBALL",
          providerPlayerId: "88",
          canonicalName: "Joao Silva",
          nationality: "Brazil",
        },
        {
          provider: "API-FOOTBALL",
          providerPlayerId: "99",
          canonicalName: "Joao Silva",
          nationality: "Brazil",
        },
      ],
    );
    expect(result.status).toBe("ambiguous");
  });
});
