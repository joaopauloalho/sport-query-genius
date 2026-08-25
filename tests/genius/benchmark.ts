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
  filter_field?: string;
  filter_operator?: string;
  group_by?: string;
  sort_direction?: string;
  limit?: number;
  providers?: string[];
  data_families?: string[];
  executor?: string;
};

type GeniusCase = {
  id: string;
  question: string;
  raw: unknown;
  expected: Expected;
};

const teams = [
  "Corinthians",
  "Palmeiras",
  "Flamengo",
  "Benfica",
  "Arsenal",
  "Barcelona",
  "Bayern",
  "Inter",
];
const legacyMetrics = ["goals_for", "corners", "shots", "shots_on_target"];
const aggregations = ["average", "total", "median"];
const venues = ["all", "home", "away"] as const;
const fixtureStatsMetrics = [
  "shots",
  "shots_on_target",
  "shots_off_target",
  "blocked_shots",
  "offsides",
  "corners",
  "passes",
  "accurate_passes",
  "pass_accuracy",
  "possession",
  "fouls",
  "yellow_cards",
  "red_cards",
  "cards",
  "xg",
  "saves",
] as const;
const naturalTemplates = [
  (team: string, metric: string) => `qual a média de ${metric} do ${team}?`,
  (team: string, metric: string) => `${team} ${metric} ultimos jogos`,
  (team: string, metric: string) =>
    `Me mostre, por favor, o desempenho de ${metric} do ${team} nas partidas recentes.`,
  (team: string, metric: string) => `qto de ${metric} o ${team} tem?`,
];

function baseRaw(team: string, metric: string, aggregation: string, venue: string, index: number) {
  return {
    sport: "football",
    entity: { type: "team", name: team },
    query_kind: "aggregate",
    metric,
    aggregation,
    scope: {
      last_matches: [3, 5, 10, 20, 50, 100][index % 6],
      venue,
      half: "full",
      status: "finished",
    },
    filters: [],
    group_by: [],
  };
}

function fixtureStatProviders(metric: string): string[] | undefined {
  if (metric === "xg") return ["BSD"];
  if (metric === "saves") return ["API-FOOTBALL"];
  return undefined;
}

function aggregateRaw(team: string, metric: string, filters: unknown[] = []) {
  return {
    sport: "football",
    entity: { type: "team", name: team },
    query_kind: "aggregate",
    metric,
    aggregation: "average",
    scope: { last_matches: 30, venue: "all", half: "full", status: "finished" },
    filters,
    group_by: [],
  };
}

export function buildGeniusCorpus(): GeniusCase[] {
  const cases: GeniusCase[] = [];
  let index = 0;

  // 288 Phase 5A baseline cases.
  for (const team of teams) {
    for (const metric of legacyMetrics) {
      for (const aggregation of aggregations) {
        for (const venue of venues) {
          cases.push({
            id: `matrix-${index}`,
            question: naturalTemplates[index % naturalTemplates.length](team, metric),
            raw: baseRaw(team, metric, aggregation, venue, index),
            expected: { supported: true, query_kind: "aggregate", metric, aggregation },
          });
          index += 1;
        }
      }
    }
  }

  // 72 score-filter regression cases.
  const outcomes = ["venceu", "empatou", "perdeu"];
  const canonicalOutcomes = ["win", "draw", "loss"];
  for (const team of teams) {
    for (let metricIndex = 0; metricIndex < 3; metricIndex += 1) {
      for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex += 1) {
        const metric = legacyMetrics[metricIndex + 1];
        cases.push({
          id: `filter-${team}-${metric}-${outcomeIndex}`,
          question: `Qual a média de ${metric} do ${team} nos jogos em que ${outcomes[outcomeIndex]}?`,
          raw: aggregateRaw(team, metric, [
            { field: "resultado", operator: "eq", value: canonicalOutcomes[outcomeIndex] },
          ]),
          expected: {
            supported: true,
            query_kind: "aggregate",
            metric,
            aggregation: "average",
            filter_field: "outcome",
          },
        });
      }
    }
  }

  // 8 Phase 5A/5B required truth cases (baseline reaches 368).
  cases.push(
    {
      id: "required-outcome-win",
      question: "Qual a média de escanteios do Corinthians nos jogos em que venceu?",
      raw: aggregateRaw("Corinthians", "corners", [
        { field: "resultado", operator: "eq", value: "venceu" },
      ]),
      expected: {
        supported: true,
        metric: "corners",
        filter_field: "outcome",
        data_families: ["fixtures", "fixture_score", "fixture_stats"],
      },
    },
    {
      id: "required-possession-filter",
      question: "Qual a média de gols nos jogos em que teve mais de 60% de posse?",
      raw: aggregateRaw("Corinthians", "goals_for", [
        { field: "posse", operator: "maior que", value: 60 },
      ]),
      expected: {
        supported: true,
        metric: "goals_for",
        filter_field: "possession",
        filter_operator: "gt",
        data_families: ["fixtures", "fixture_score", "fixture_stats"],
      },
    },
    {
      id: "required-home-away",
      question: "Compare casa e fora",
      raw: { ...aggregateRaw("Corinthians", "goals_for"), group_by: ["casa e fora"] },
      expected: { supported: true, group_by: "venue" },
    },
    {
      id: "required-top-opponents",
      question: "Mostre os 5 adversários contra quem teve maior média de gols",
      raw: {
        ...aggregateRaw("Corinthians", "goals_for"),
        group_by: ["adversario"],
        sort: { field: "value", direction: "desc" },
        limit: 5,
      },
      expected: { supported: true, group_by: "opponent", sort_direction: "desc", limit: 5 },
    },
    {
      id: "required-current-season-no-competition",
      question: "Temporada atual do Benfica",
      raw: {
        ...aggregateRaw("Benfica", "goals_for"),
        scope: { season: "current", venue: "all", half: "full", status: "finished" },
      },
      expected: { supported: false },
    },
    {
      id: "required-possession-executor",
      question: "Qual a média de posse do Corinthians?",
      raw: aggregateRaw("Corinthians", "possession"),
      expected: {
        supported: true,
        metric: "possession",
        data_families: ["fixtures", "fixture_stats"],
        executor: "team_universal_aggregate",
      },
    },
    {
      id: "required-unknown-filter",
      question: "Média de gols quando a pressão alta passou de 7",
      raw: aggregateRaw("Corinthians", "goals_for", [
        { field: "pressao alta", operator: "gt", value: 7 },
      ]),
      expected: { supported: false, filter_field: "pressao_alta" },
    },
    {
      id: "required-unknown-group",
      question: "Agrupe a média de gols pela era do árbitro",
      raw: { ...aggregateRaw("Corinthians", "goals_for"), group_by: ["arbitro era"] },
      expected: { supported: false, group_by: "arbitro_era" },
    },
  );

  // +256: 16 normalized fixture-stat metrics × 8 teams × 2 aggregations = 624 total.
  for (const team of teams) {
    for (const metric of fixtureStatsMetrics) {
      for (const aggregation of ["average", "total"] as const) {
        cases.push({
          id: `phase5b-stat-${team}-${metric}-${aggregation}`,
          question: `${aggregation} de ${metric} do ${team}`,
          raw: { ...aggregateRaw(team, metric), aggregation },
          expected: {
            supported: true,
            query_kind: "aggregate",
            metric,
            aggregation,
            providers: fixtureStatProviders(metric),
            data_families: ["fixtures", "fixture_stats"],
            executor: "team_universal_aggregate",
          },
        });
      }
    }
  }

  // +56: all generic operators × all teams = 680 total.
  const operatorCases: Array<[string, unknown]> = [
    ["eq", 10],
    ["neq", 10],
    ["gt", 10],
    ["gte", 10],
    ["lt", 10],
    ["lte", 10],
    ["in", [8, 10, 12]],
  ];
  for (const team of teams) {
    for (const [operator, value] of operatorCases) {
      cases.push({
        id: `phase5b-op-${team}-${operator}`,
        question: `escanteios do ${team} filtrados por chutes ${operator}`,
        raw: aggregateRaw(team, "corners", [{ field: "shots", operator, value }]),
        expected: {
          supported: true,
          metric: "corners",
          filter_field: "shots",
          filter_operator: operator,
          data_families: ["fixtures", "fixture_stats"],
        },
      });
    }
  }

  // +16: score + fixture_stats multi-family plans = 696 total.
  for (const team of teams) {
    cases.push({
      id: `phase5b-multi-family-stat-score-${team}`,
      question: `posse do ${team} nos jogos em que venceu`,
      raw: aggregateRaw(team, "possession", [{ field: "outcome", operator: "eq", value: "win" }]),
      expected: {
        supported: true,
        metric: "possession",
        filter_field: "outcome",
        data_families: ["fixtures", "fixture_score", "fixture_stats"],
      },
    });
    cases.push({
      id: `phase5b-multi-family-score-stat-${team}`,
      question: `gols do ${team} em jogos com mais de 10 chutes`,
      raw: aggregateRaw(team, "goals_for", [{ field: "shots", operator: "gt", value: 10 }]),
      expected: {
        supported: true,
        metric: "goals_for",
        filter_field: "shots",
        data_families: ["fixtures", "fixture_score", "fixture_stats"],
      },
    });
  }

  // +8: match_list must preserve and output requested raw metric = 704 total.
  for (const team of teams) {
    cases.push({
      id: `phase5b-match-list-${team}`,
      question: `jogos do ${team} com pelo menos 6 escanteios`,
      raw: {
        sport: "football",
        entity: { type: "team", name: team },
        query_kind: "match_list",
        metric: "corners",
        scope: { last_matches: 30, venue: "all", half: "full", status: "finished" },
        filters: [{ field: "corners", operator: "gte", value: 6 }],
        group_by: [],
      },
      expected: {
        supported: true,
        query_kind: "match_list",
        metric: "corners",
        filter_field: "corners",
        data_families: ["fixtures", "fixture_stats"],
        executor: "team_universal_match_list",
      },
    });
  }

  // +9 provider-backed season negotiation cases = 713 total.
  const seasonCases = [
    ["Benfica", "Champions League", "2025/26", "possession"],
    ["Arsenal", "Premier League", "2025/26", "shots_on_target"],
    ["Corinthians", "Brasileirão Série A", "2026", "corners"],
    ["Benfica", "Champions League", "current", "shots"],
    ["Arsenal", "Premier League", "previous", "corners"],
    ["Barcelona", "La Liga", "2025/26", "possession"],
    ["Bayern", "Bundesliga", "2025/26", "shots"],
    ["Flamengo", "Brasileirão Série A", "2026", "shots_on_target"],
    ["Inter", "Champions League", "2025/26", "fouls"],
  ] as const;
  for (const [team, competition, season, metric] of seasonCases) {
    cases.push({
      id: `phase5b-season-${team}-${season}`,
      question: `${metric} do ${team} em ${competition} ${season}`,
      raw: {
        ...aggregateRaw(team, metric),
        scope: {
          competition,
          season,
          venue: "all",
          half: "full",
          status: "finished",
        },
      },
      expected: {
        supported: true,
        metric,
        data_families: ["fixtures", "fixture_stats", "league_season"],
      },
    });
  }

  // +6 explicit fail-closed negatives = exactly 719 total.
  cases.push(
    {
      id: "phase5b-negative-unmapped-metric",
      question: "toques na área do Corinthians",
      raw: aggregateRaw("Corinthians", "touches_in_box"),
      expected: { supported: false, metric: "touches_in_box" },
    },
    {
      id: "phase5b-negative-provider-intersection",
      question: "xg em jogos com defesas do goleiro",
      raw: aggregateRaw("Corinthians", "xg", [{ field: "saves", operator: "gte", value: 1 }]),
      expected: { supported: false, metric: "xg", filter_field: "saves" },
    },
    {
      id: "phase5b-negative-season-no-competition",
      question: "Arsenal na temporada anterior",
      raw: {
        ...aggregateRaw("Arsenal", "corners"),
        scope: { season: "previous", venue: "all", half: "full", status: "finished" },
      },
      expected: { supported: false, metric: "corners" },
    },
    {
      id: "phase5b-negative-match-list-sort",
      question: "liste jogos por posse descendente",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "match_list",
        metric: "possession",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
        sort: { field: "value", direction: "desc" },
      },
      expected: { supported: false, metric: "possession", sort_direction: "desc" },
    },
    {
      id: "phase5b-negative-match-list-group",
      question: "liste jogos agrupados por adversário",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "match_list",
        metric: "corners",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: ["opponent"],
      },
      expected: { supported: false, metric: "corners", group_by: "opponent" },
    },
    {
      id: "phase5b-negative-unknown-stat-filter",
      question: "posse com pressão alta maior que 8",
      raw: aggregateRaw("Corinthians", "possession", [
        { field: "pressao alta", operator: "gt", value: 8 },
      ]),
      expected: { supported: false, metric: "possession", filter_field: "pressao_alta" },
    },
  );

  if (cases.length !== 719) {
    throw new Error(
      `Phase 5B benchmark corpus must contain exactly 719 cases, got ${cases.length}`,
    );
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
  if (expected.filter_field && query.filters[0]?.field !== expected.filter_field) return false;
  if (expected.filter_operator && query.filters[0]?.operator !== expected.filter_operator)
    return false;
  if (expected.group_by && query.group_by[0] !== expected.group_by) return false;
  if (expected.sort_direction && query.sort?.direction !== expected.sort_direction) return false;
  if (expected.limit && query.limit !== expected.limit) return false;
  return true;
}

export function runGeniusBenchmark() {
  const corpus = buildGeniusCorpus();
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

    if (testCase.expected.filter_field && semantic.query.filters.length === 0)
      silentSemanticLoss += 1;
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
  const report = runGeniusBenchmark();
  console.log("GENIUS BENCHMARK");
  console.log("----------------");
  console.log(`Total cases: ${report.total}`);
  console.log(`Semantic correct: ${report.semantic_accuracy}%`);
  console.log(`Capability decisions correct: ${report.capability_accuracy}%`);
  console.log(`Unsupported correctly rejected: ${report.unsupported_rejection_accuracy}%`);
  console.log(`Silent semantic loss: ${report.silent_semantic_loss}`);
  console.log(`Benchmark passed: ${report.passed ? "YES" : "NO"}`);
  if (report.failures.length) console.log(`Failures: ${report.failures.join("; ")}`);
  if (!report.passed) process.exitCode = 1;
}
