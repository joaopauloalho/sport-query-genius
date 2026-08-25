import { normalizeTruthfulSemanticCandidate } from "../../src/server/analysis/query-plan-v5a-normalizer";
import {
  createSemanticPlan,
  semanticPlanResponseSchema,
  type SemanticQuery,
} from "../../src/server/analysis/semantic-plan";
import { negotiateFootballCapability } from "../../src/server/sports/capability-negotiation";

type Expected = {
  supported: boolean;
  query_kind?: string;
  metric?: string;
  aggregation?: string;
  filter_fields?: string[];
  group_by?: string[];
  sort_direction?: string;
  limit?: number;
  providers?: string[];
  data_families?: string[];
  executor?: string;
};

type BenchmarkCase = {
  id: string;
  question: string;
  raw: unknown;
  expected: Expected;
};

const players = [
  "Yuri Alberto",
  "Lamine Yamal",
  "Bukayo Saka",
  "Vinicius Junior",
  "Rodri",
  "Alisson",
] as const;

const metrics = [
  "goals",
  "assists",
  "goal_contributions",
  "shots",
  "shots_on_target",
  "rating",
  "passes",
  "accurate_passes",
  "pass_accuracy",
  "key_passes",
  "tackles",
  "interceptions",
] as const;

function aggregateRaw(
  player: string,
  metric: string,
  aggregation = "average",
  filters: unknown[] = [],
) {
  return {
    sport: "football",
    entity: { type: "player", name: player },
    query_kind: "aggregate",
    metric,
    aggregation,
    scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
    filters,
    group_by: [],
  };
}

function buildCases(): BenchmarkCase[] {
  const cases: BenchmarkCase[] = [];

  // 144: broad player metric/aggregation matrix.
  for (const player of players) {
    for (const metric of metrics) {
      for (const aggregation of ["average", "total"] as const) {
        cases.push({
          id: `phase5c-matrix-${player}-${metric}-${aggregation}`,
          question: `${aggregation} de ${metric} de ${player} nas últimas 10 aparições`,
          raw: aggregateRaw(player, metric, aggregation),
          expected: {
            supported: true,
            query_kind: "aggregate",
            metric,
            aggregation,
            providers: ["BSD"],
            data_families: ["fixtures", "player_match_stats"],
            executor: "player_universal_aggregate",
          },
        });
      }
    }
  }

  // +30 = 174: output metric independent from filter metric and generic operators.
  const filterCases = [
    ["goals", "shots", "gte", 4],
    ["assists", "passes", "gt", 25],
    ["passes", "rating", "gte", 7],
    ["tackles", "minutes", "gt", 60],
    ["rating", "shots_on_target", "in", [1, 2, 3]],
  ] as const;
  for (const player of players) {
    for (const [metric, field, operator, value] of filterCases) {
      cases.push({
        id: `phase5c-filter-${player}-${metric}-${field}-${operator}`,
        question: `${metric} de ${player} quando ${field} ${operator}`,
        raw: aggregateRaw(player, metric, "average", [{ field, operator, value }]),
        expected: {
          supported: true,
          metric,
          aggregation: "average",
          filter_fields: [field],
          providers: ["BSD"],
          data_families: ["fixtures", "player_match_stats"],
          executor: "player_universal_aggregate",
        },
      });
    }
  }

  // +18 = 192: grouping, sort and presentation limit stay explicit.
  const groupCases = [
    ["venue", "desc", 2],
    ["competition", "asc", 5],
    ["opponent", "desc", 5],
  ] as const;
  for (const player of players) {
    for (const [group, direction, limit] of groupCases) {
      cases.push({
        id: `phase5c-group-${player}-${group}`,
        question: `agrupe passes de ${player} por ${group}`,
        raw: {
          ...aggregateRaw(player, "passes"),
          group_by: [group],
          sort: { field: "value", direction },
          limit,
        },
        expected: {
          supported: true,
          metric: "passes",
          aggregation: "average",
          group_by: [group],
          sort_direction: direction,
          limit,
          providers: ["BSD"],
          data_families: ["fixtures", "player_match_stats"],
          executor: "player_universal_aggregate",
        },
      });
    }
  }

  // +12 = 204: player match_list output is first-class and metric-specific.
  for (const player of players) {
    for (const metric of ["goals", "passes"] as const) {
      cases.push({
        id: `phase5c-match-list-${player}-${metric}`,
        question: `liste partidas de ${player} com ${metric}`,
        raw: {
          sport: "football",
          entity: { type: "player", name: player },
          query_kind: "match_list",
          metric,
          scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
          filters: [],
          group_by: [],
        },
        expected: {
          supported: true,
          query_kind: "match_list",
          metric,
          providers: ["BSD"],
          data_families: ["fixtures", "player_match_stats"],
          executor: "player_universal_match_list",
        },
      });
    }
  }

  // +12 = 216: explicit fail-closed negatives.
  cases.push(
    {
      id: "phase5c-negative-team-only-metric",
      question: "escanteios de Yuri Alberto",
      raw: aggregateRaw("Yuri Alberto", "corners"),
      expected: { supported: false, metric: "corners" },
    },
    {
      id: "phase5c-negative-rate",
      question: "taxa de passes de Yuri Alberto",
      raw: aggregateRaw("Yuri Alberto", "passes", "rate"),
      expected: { supported: false, metric: "passes", aggregation: "rate" },
    },
    {
      id: "phase5c-negative-percentage",
      question: "percentual de gols de Yuri Alberto",
      raw: aggregateRaw("Yuri Alberto", "goals", "percentage"),
      expected: { supported: false, metric: "goals", aggregation: "percentage" },
    },
    {
      id: "phase5c-negative-half",
      question: "passes no primeiro tempo",
      raw: {
        ...aggregateRaw("Yuri Alberto", "passes"),
        scope: { last_matches: 10, venue: "all", half: "first", status: "finished" },
      },
      expected: { supported: false, metric: "passes" },
    },
    {
      id: "phase5c-negative-live",
      question: "passes ao vivo",
      raw: {
        ...aggregateRaw("Yuri Alberto", "passes"),
        scope: { venue: "all", half: "full", status: "live" },
      },
      expected: { supported: false, metric: "passes" },
    },
    {
      id: "phase5c-negative-event-assist",
      question: "liste assistências de Yuri Alberto",
      raw: {
        sport: "football",
        entity: { type: "player", name: "Yuri Alberto" },
        query_kind: "event_list",
        event_type: "assist",
        scope: { limit: 5, venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      },
      expected: { supported: false, query_kind: "event_list" },
    },
    {
      id: "phase5c-negative-unknown-filter",
      question: "gols quando pressão alta > 7",
      raw: aggregateRaw("Yuri Alberto", "goals", "average", [
        { field: "pressao alta", operator: "gt", value: 7 },
      ]),
      expected: { supported: false, metric: "goals", filter_fields: ["pressao_alta"] },
    },
    {
      id: "phase5c-negative-unknown-group",
      question: "passes por era do árbitro",
      raw: { ...aggregateRaw("Yuri Alberto", "passes"), group_by: ["arbitro era"] },
      expected: { supported: false, metric: "passes", group_by: ["arbitro_era"] },
    },
    {
      id: "phase5c-negative-sort-without-group",
      question: "ordene média de passes",
      raw: {
        ...aggregateRaw("Yuri Alberto", "passes"),
        sort: { field: "value", direction: "desc" },
      },
      expected: { supported: false, metric: "passes", sort_direction: "desc" },
    },
    {
      id: "phase5c-negative-season-no-competition",
      question: "passes na temporada atual",
      raw: {
        ...aggregateRaw("Yuri Alberto", "passes"),
        scope: { season: "current", venue: "all", half: "full", status: "finished" },
      },
      expected: { supported: false, metric: "passes" },
    },
    {
      id: "phase5c-negative-player-comparison",
      question: "compare passes de Yuri Alberto e Lamine Yamal",
      raw: {
        sport: "football",
        entity: { type: "player", name: "Yuri Alberto" },
        query_kind: "comparison",
        metric: "passes",
        aggregation: "average",
        scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
        compare_with: { type: "player", name: "Lamine Yamal" },
      },
      expected: { supported: false, query_kind: "comparison", metric: "passes" },
    },
    {
      id: "phase5c-negative-player-match-list-group",
      question: "liste jogos agrupados por adversário",
      raw: {
        sport: "football",
        entity: { type: "player", name: "Yuri Alberto" },
        query_kind: "match_list",
        metric: "passes",
        scope: { last_matches: 10, venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: ["opponent"],
      },
      expected: { supported: false, query_kind: "match_list", metric: "passes", group_by: ["opponent"] },
    },
  );

  if (cases.length !== 216) {
    throw new Error(`Phase 5C benchmark corpus must contain exactly 216 cases, got ${cases.length}`);
  }
  return cases;
}

function sameSet(actual: readonly string[], expected: readonly string[]): boolean {
  return [...actual].sort().join("|") === [...expected].sort().join("|");
}

function checkExpected(query: SemanticQuery, expected: Expected): boolean {
  if (expected.query_kind && query.query_kind !== expected.query_kind) return false;
  if (expected.metric && query.metric !== expected.metric) return false;
  if (expected.aggregation && query.aggregation !== expected.aggregation) return false;
  if (expected.filter_fields && !sameSet(query.filters.map((filter) => filter.field), expected.filter_fields)) {
    return false;
  }
  if (expected.group_by && !sameSet(query.group_by, expected.group_by)) return false;
  if (expected.sort_direction && query.sort?.direction !== expected.sort_direction) return false;
  if (expected.limit && query.limit !== expected.limit) return false;
  return true;
}

export function runPhase5cGeniusBenchmark() {
  const corpus = buildCases();
  let semanticCorrect = 0;
  let capabilityCorrect = 0;
  let unsupportedExpected = 0;
  let unsupportedCorrect = 0;
  let silentSemanticLoss = 0;
  const failures: string[] = [];

  for (const testCase of corpus) {
    const normalized = normalizeTruthfulSemanticCandidate(testCase.raw);
    const parsed = semanticPlanResponseSchema.safeParse(normalized);
    if (!parsed.success || "error" in parsed.data) {
      failures.push(`${testCase.id}: semantic schema rejected`);
      continue;
    }
    const semantic = createSemanticPlan(parsed.data, testCase.raw);
    const semanticsOk = checkExpected(semantic.query, testCase.expected);
    if (semanticsOk) semanticCorrect += 1;
    else failures.push(`${testCase.id}: semantic mismatch`);

    if (testCase.expected.filter_fields && semantic.query.filters.length === 0) silentSemanticLoss += 1;
    if (testCase.expected.group_by && semantic.query.group_by.length === 0) silentSemanticLoss += 1;
    if (testCase.expected.sort_direction && !semantic.query.sort) silentSemanticLoss += 1;

    const decision = negotiateFootballCapability(semantic);
    let decisionOk = decision.supported === testCase.expected.supported;
    if (decisionOk && decision.supported && testCase.expected.providers) {
      decisionOk = sameSet(decision.providers, testCase.expected.providers);
    }
    if (decisionOk && decision.supported && testCase.expected.data_families) {
      decisionOk = sameSet(decision.data_families, testCase.expected.data_families);
    }
    if (decisionOk && decision.supported && testCase.expected.executor) {
      decisionOk = decision.executor === testCase.expected.executor;
    }
    if (decisionOk) capabilityCorrect += 1;
    else {
      failures.push(
        `${testCase.id}: capability expected ${testCase.expected.supported} got ${decision.supported}` +
          (decision.supported
            ? ` providers=${decision.providers.join(",")} families=${decision.data_families.join(",")} executor=${decision.executor}`
            : ` reason=${decision.reason}`),
      );
    }

    if (!testCase.expected.supported) {
      unsupportedExpected += 1;
      if (!decision.supported) unsupportedCorrect += 1;
    }
  }

  const percent = (value: number, total: number) =>
    total ? Math.round((value / total) * 10000) / 100 : 100;
  return {
    total: corpus.length,
    semantic_correct: semanticCorrect,
    semantic_accuracy: percent(semanticCorrect, corpus.length),
    capability_correct: capabilityCorrect,
    capability_accuracy: percent(capabilityCorrect, corpus.length),
    unsupported_expected: unsupportedExpected,
    unsupported_correct: unsupportedCorrect,
    unsupported_rejection_accuracy: percent(unsupportedCorrect, unsupportedExpected),
    silent_semantic_loss: silentSemanticLoss,
    passed: failures.length === 0 && silentSemanticLoss === 0,
    failures,
  };
}

if (import.meta.main) {
  const report = runPhase5cGeniusBenchmark();
  console.log("GENIUS BENCHMARK — PHASE 5C PLAYER");
  console.log("-----------------------------------");
  console.log(`Total cases: ${report.total}`);
  console.log(`Semantic correct: ${report.semantic_accuracy}%`);
  console.log(`Capability decisions correct: ${report.capability_accuracy}%`);
  console.log(`Unsupported correctly rejected: ${report.unsupported_rejection_accuracy}%`);
  console.log(`Silent semantic loss: ${report.silent_semantic_loss}`);
  console.log(`Benchmark passed: ${report.passed ? "YES" : "NO"}`);
  if (report.failures.length) console.log(`Failures: ${report.failures.join("; ")}`);
  if (!report.passed) process.exitCode = 1;
}
