import { isDeepStrictEqual } from "node:util";

import { parseDeterministicPhase5cPlayerQuestion } from "../../src/server/analysis/phase5c-deterministic-player-parser";
import type { SemanticQuery } from "../../src/server/analysis/semantic-plan";

type PlanSummary = {
  entity: { type: string; name: string };
  query_kind: string;
  metric: string | null;
  aggregation: string | null;
  scope: SemanticQuery["scope"];
  filters: SemanticQuery["filters"];
  group_by: string[];
};

type NaturalLanguageCase = {
  id: string;
  question: string;
  expected: PlanSummary;
};

const scope = (extra: Partial<SemanticQuery["scope"]> = {}): SemanticQuery["scope"] => ({
  venue: "all",
  half: "full",
  status: "finished",
  ...extra,
});

const aggregate = (
  name: string,
  metric: string,
  aggregation: "average" | "total",
  options: {
    scope?: Partial<SemanticQuery["scope"]>;
    filters?: SemanticQuery["filters"];
    group_by?: string[];
  } = {},
): PlanSummary => ({
  entity: { type: "player", name },
  query_kind: "aggregate",
  metric,
  aggregation,
  scope: scope(options.scope),
  filters: options.filters ?? [],
  group_by: options.group_by ?? [],
});

const matchList = (
  name: string,
  metric: string,
  options: {
    scope?: Partial<SemanticQuery["scope"]>;
    filters?: SemanticQuery["filters"];
  } = {},
): PlanSummary => ({
  entity: { type: "player", name },
  query_kind: "match_list",
  metric,
  aggregation: null,
  scope: scope(options.scope),
  filters: options.filters ?? [],
  group_by: [],
});

export const PHASE5C_NATURAL_LANGUAGE_CASES: readonly NaturalLanguageCase[] = [
  {
    id: "production-regression-yuri-passes-average-last10",
    question: "Qual foi a média de passes do Yuri Alberto nos últimos 10 jogos?",
    expected: aggregate("Yuri Alberto", "passes", "average", { scope: { last_matches: 10 } }),
  },
  {
    id: "average-variation-rodri",
    question: "Qual a média de passes do Rodri nos últimos 5 jogos?",
    expected: aggregate("Rodri", "passes", "average", { scope: { last_matches: 5 } }),
  },
  {
    id: "average-without-question-prefix",
    question: "Média de passes do Yuri Alberto nos últimos 10 jogos",
    expected: aggregate("Yuri Alberto", "passes", "average", { scope: { last_matches: 10 } }),
  },
  {
    id: "noun-before-average-rating",
    question: "Qual foi a nota média do Rodri nos últimos 10 jogos?",
    expected: aggregate("Rodri", "rating", "average", { scope: { last_matches: 10 } }),
  },
  {
    id: "total-goals-natural-verb",
    question: "Quantos gols o Haaland marcou nos últimos 8 jogos?",
    expected: aggregate("Haaland", "goals", "total", { scope: { last_matches: 8 } }),
  },
  {
    id: "total-assists",
    question: "Total de assistências do Saka nos últimos 10 jogos",
    expected: aggregate("Saka", "assists", "total", { scope: { last_matches: 10 } }),
  },
  {
    id: "derived-goal-contributions",
    question: "Quantas participações em gols o Vinicius Junior teve nos últimos 10 jogos?",
    expected: aggregate("Vinicius Junior", "goal_contributions", "total", {
      scope: { last_matches: 10 },
    }),
  },
  {
    id: "derived-goals-plus-assists-alias",
    question: "Total de gols + assistências do Saka nos últimos 8 jogos",
    expected: aggregate("Saka", "goal_contributions", "total", { scope: { last_matches: 8 } }),
  },
  {
    id: "venue-away",
    question: "Qual a média de desarmes do Rodri fora de casa nos últimos 12 jogos?",
    expected: aggregate("Rodri", "tackles", "average", {
      scope: { venue: "away", last_matches: 12 },
    }),
  },
  {
    id: "venue-home",
    question: "Qual foi a média de passes do Yuri Alberto em casa nos últimos 10 jogos?",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      scope: { venue: "home", last_matches: 10 },
    }),
  },
  {
    id: "filter-shots",
    question:
      "Qual foi a média de gols do Yuri Alberto nos jogos em que finalizou pelo menos 4 vezes?",
    expected: aggregate("Yuri Alberto", "goals", "average", {
      filters: [{ field: "shots", operator: "gte", value: 4 }],
    }),
  },
  {
    id: "filter-rating",
    question:
      "Qual foi a média de passes do Yuri Alberto nos jogos em que teve nota maior ou igual a 7?",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      filters: [{ field: "rating", operator: "gte", value: 7 }],
    }),
  },
  {
    id: "and-filters",
    question:
      "Qual foi a média de passes do Yuri Alberto nos jogos em que teve pelo menos 2 desarmes e nota maior ou igual a 7?",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      filters: [
        { field: "tackles", operator: "gte", value: 2 },
        { field: "rating", operator: "gte", value: 7 },
      ],
    }),
  },
  {
    id: "competition-season",
    question: "Qual foi a média de passes do Bukayo Saka na Premier League 2025/26?",
    expected: aggregate("Bukayo Saka", "passes", "average", {
      scope: { competition: "Premier League", season: "2025/26" },
    }),
  },
  {
    id: "opponent",
    question: "Qual foi a média de passes do Yuri Alberto contra o Palmeiras?",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      scope: { opponent: "Palmeiras" },
    }),
  },
  {
    id: "match-list-last10-passes",
    question: "Liste os últimos 10 jogos do Yuri Alberto mostrando os passes dele.",
    expected: matchList("Yuri Alberto", "passes", { scope: { last_matches: 10 } }),
  },
  {
    id: "match-list-filter-and-output-metric",
    question: "Liste os jogos do Saka em que teve nota maior ou igual a 7 mostrando assistências.",
    expected: matchList("Saka", "assists", {
      filters: [{ field: "rating", operator: "gte", value: 7 }],
    }),
  },
  {
    id: "group-by-venue",
    question: "Compare a média de passes do Yuri Alberto em casa e fora nos últimos 20 jogos.",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      scope: { last_matches: 20 },
      group_by: ["venue"],
    }),
  },
  {
    id: "group-by-competition",
    question: "Qual foi a média de passes do Yuri Alberto por competição nos últimos 20 jogos?",
    expected: aggregate("Yuri Alberto", "passes", "average", {
      scope: { last_matches: 20 },
      group_by: ["competition"],
    }),
  },
] as const;

export const PHASE5C_NATURAL_LANGUAGE_NEGATIVES = [
  "Qual a média de passes do Yuri Alberto nos últimos 10 jogos quando Marte estava retrógrado?",
  "Qual foi a média de posse de bola do Yuri Alberto?",
  "Qual foi a média de passes do Yuri Alberto no segundo tempo?",
  "Liste as últimas 5 assistências do Yuri Alberto dizendo em que minuto ocorreram.",
  "Quem foi o jogador sub-23 do Brasileirão com mais participações em gols nos últimos 10 jogos?",
  "Compare a média de passes do Yuri Alberto com a do Haaland nos últimos 10 jogos.",
] as const;

function summarize(query: SemanticQuery): PlanSummary {
  return {
    entity: { type: query.entity.type, name: query.entity.name },
    query_kind: query.query_kind,
    metric: query.metric ?? null,
    aggregation: query.aggregation ?? null,
    scope: query.scope,
    filters: query.filters,
    group_by: query.group_by,
  };
}

export function runPhase5cNaturalLanguageBenchmark() {
  const failures: string[] = [];
  let semanticCorrect = 0;
  let negativeCorrect = 0;
  let silentSemanticLoss = 0;

  for (const testCase of PHASE5C_NATURAL_LANGUAGE_CASES) {
    const query = parseDeterministicPhase5cPlayerQuestion(testCase.question);
    if (!query) {
      failures.push(`${testCase.id}: parser returned null`);
      continue;
    }
    if (isDeepStrictEqual(summarize(query), testCase.expected)) {
      semanticCorrect += 1;
    } else {
      silentSemanticLoss += 1;
      failures.push(`${testCase.id}: SemanticPlan mismatch`);
    }
  }

  for (const question of PHASE5C_NATURAL_LANGUAGE_NEGATIVES) {
    const query = parseDeterministicPhase5cPlayerQuestion(question);
    if (query === null) negativeCorrect += 1;
    else {
      silentSemanticLoss += 1;
      failures.push(`negative recognized unexpectedly: ${question}`);
    }
  }

  const positiveTotal = PHASE5C_NATURAL_LANGUAGE_CASES.length;
  const negativeTotal = PHASE5C_NATURAL_LANGUAGE_NEGATIVES.length;
  const total = positiveTotal + negativeTotal;
  const percent = (value: number, count: number) =>
    count ? Math.round((value / count) * 10000) / 100 : 100;

  return {
    total,
    positive_total: positiveTotal,
    semantic_correct: semanticCorrect,
    semantic_accuracy: percent(semanticCorrect, positiveTotal),
    negative_total: negativeTotal,
    negative_correct: negativeCorrect,
    negative_rejection_accuracy: percent(negativeCorrect, negativeTotal),
    silent_semantic_loss: silentSemanticLoss,
    passed:
      semanticCorrect === positiveTotal &&
      negativeCorrect === negativeTotal &&
      silentSemanticLoss === 0 &&
      failures.length === 0,
    failures,
  };
}

if (import.meta.main) {
  const report = runPhase5cNaturalLanguageBenchmark();
  console.log("GENIUS BENCHMARK — PHASE 5C NATURAL LANGUAGE");
  console.log("----------------------------------------------");
  console.log(`Total cases: ${report.total}`);
  console.log(`Semantic string-to-plan correct: ${report.semantic_accuracy}%`);
  console.log(`Fail-closed negatives correct: ${report.negative_rejection_accuracy}%`);
  console.log(`Silent semantic loss: ${report.silent_semantic_loss}`);
  console.log(`Benchmark passed: ${report.passed ? "YES" : "NO"}`);
  if (report.failures.length) console.log(`Failures: ${report.failures.join("; ")}`);
  if (!report.passed) process.exitCode = 1;
}
