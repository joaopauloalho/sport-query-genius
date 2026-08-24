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
  group_by?: string;
  sort_direction?: string;
  limit?: number;
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
const metrics = ["goals_for", "corners", "shots", "shots_on_target"];
const aggregations = ["average", "total", "median"];
const venues = ["all", "home", "away"] as const;
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

export function buildGeniusCorpus(): GeniusCase[] {
  const cases: GeniusCase[] = [];
  let index = 0;
  for (const team of teams) {
    for (const metric of metrics) {
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

  const outcomes = ["venceu", "empatou", "perdeu"];
  const canonicalOutcomes = ["win", "draw", "loss"];
  for (const team of teams) {
    for (let metricIndex = 0; metricIndex < 3; metricIndex += 1) {
      for (let outcomeIndex = 0; outcomeIndex < outcomes.length; outcomeIndex += 1) {
        const metric = metrics[metricIndex + 1];
        cases.push({
          id: `filter-${team}-${metric}-${outcomeIndex}`,
          question: `Qual a média de ${metric} do ${team} nos jogos em que ${outcomes[outcomeIndex]}?`,
          raw: {
            sport: "football",
            entity: { type: "team", name: team },
            query_kind: "aggregate",
            metric,
            aggregation: "average",
            scope: { last_matches: 30, venue: "all", half: "full", status: "finished" },
            filters: [
              { field: "resultado", operator: "eq", value: canonicalOutcomes[outcomeIndex] },
            ],
            group_by: [],
          },
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

  cases.push(
    {
      id: "required-outcome-win",
      question: "Qual a média de escanteios do Corinthians nos jogos em que venceu?",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "corners",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [{ field: "resultado", operator: "eq", value: "venceu" }],
        group_by: [],
      },
      expected: { supported: true, metric: "corners", filter_field: "outcome" },
    },
    {
      id: "required-possession-filter",
      question: "Qual a média de gols nos jogos em que teve mais de 60% de posse?",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [{ field: "posse", operator: "maior que", value: 60 }],
        group_by: [],
      },
      expected: { supported: false, metric: "goals_for", filter_field: "possession" },
    },
    {
      id: "required-home-away",
      question: "Compare casa e fora",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: ["casa e fora"],
      },
      expected: { supported: true, group_by: "venue" },
    },
    {
      id: "required-top-opponents",
      question: "Mostre os 5 adversários contra quem teve maior média de gols",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: ["adversario"],
        sort: { field: "value", direction: "desc" },
        limit: 5,
      },
      expected: { supported: true, group_by: "opponent", sort_direction: "desc", limit: 5 },
    },
    {
      id: "required-current-season",
      question: "Temporada atual do Benfica",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Benfica" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { season: "current", venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      },
      expected: { supported: false },
    },
    {
      id: "required-metric-no-executor",
      question: "Qual a média de posse do Corinthians?",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "possession",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: [],
      },
      expected: { supported: false, metric: "possession" },
    },
    {
      id: "required-unknown-filter",
      question: "Média de gols quando a pressão alta passou de 7",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [{ field: "pressao alta", operator: "gt", value: 7 }],
        group_by: [],
      },
      expected: { supported: false, filter_field: "pressao_alta" },
    },
    {
      id: "required-unknown-group",
      question: "Agrupe a média de gols pela era do árbitro",
      raw: {
        sport: "football",
        entity: { type: "team", name: "Corinthians" },
        query_kind: "aggregate",
        metric: "goals_for",
        aggregation: "average",
        scope: { venue: "all", half: "full", status: "finished" },
        filters: [],
        group_by: ["arbitro era"],
      },
      expected: { supported: false, group_by: "arbitro_era" },
    },
  );
  return cases;
}

function checkExpected(query: SemanticQuery, expected: Expected): boolean {
  if (expected.query_kind && query.query_kind !== expected.query_kind) return false;
  if (expected.metric && query.metric !== expected.metric) return false;
  if (expected.aggregation && query.aggregation !== expected.aggregation) return false;
  if (expected.filter_field && query.filters[0]?.field !== expected.filter_field) return false;
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

    const decision = negotiateFootballCapability(semantic);
    if (decision.supported === testCase.expected.supported) capabilityCorrect += 1;
    else
      failures.push(
        `${testCase.id}: capability expected ${testCase.expected.supported} got ${decision.supported}`,
      );
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
