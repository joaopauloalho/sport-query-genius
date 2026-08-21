import type { AnalysisResult } from "@/lib/analysis";
import type { AnalysisRequest } from "@/lib/analysis-request";
import { calculateStatistics } from "@/lib/statistics";
import { analyzeQuestionServer } from "@/server/analysis/analyze.server";

type ExpectedCase = {
  matchCount: number;
  metric: AnalysisResult["intent"]["metric"];
  aggregation: AnalysisResult["intent"]["aggregation"];
  venue: AnalysisResult["intent"]["venue"];
};

const CASES: Record<string, { input: AnalysisRequest; expected: ExpectedCase }> = {
  A: {
    input: {
      question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
      overrides: { match_count: 5 },
    },
    expected: { matchCount: 5, metric: "corners", aggregation: "average", venue: "all" },
  },
  B: {
    input: {
      question: "Qual a média de escanteios do Corinthians nos últimos 10 jogos?",
      overrides: { match_count: 10 },
    },
    expected: { matchCount: 10, metric: "corners", aggregation: "average", venue: "all" },
  },
  C: {
    input: {
      question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos em casa?",
      overrides: { match_count: 5, venue: "home" },
    },
    expected: { matchCount: 5, metric: "corners", aggregation: "average", venue: "home" },
  },
  D: {
    input: {
      question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos fora de casa?",
      overrides: { match_count: 5, venue: "away" },
    },
    expected: { matchCount: 5, metric: "corners", aggregation: "average", venue: "away" },
  },
  E: {
    input: {
      question: "Qual o total de gols do Corinthians nos últimos 10 jogos?",
      overrides: { match_count: 10 },
    },
    expected: { matchCount: 10, metric: "goals", aggregation: "total", venue: "all" },
  },
  F: {
    input: {
      question: "Qual a média de finalizações do Corinthians nos últimos 5 jogos?",
      overrides: { match_count: 5 },
    },
    expected: { matchCount: 5, metric: "shots", aggregation: "average", venue: "all" },
  },
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expectedHeadline(result: AnalysisResult): number {
  const values = result.matches.map((match) => match.value);
  const calculated = calculateStatistics(values);
  if (result.intent.aggregation === "total") return calculated.total;
  if (result.intent.aggregation === "median") return calculated.median;
  return calculated.average;
}

function validateResult(key: string, result: AnalysisResult, expected: ExpectedCase): void {
  assert(result.statistics.sample_size === expected.matchCount, `${key}: sample_size incorreto`);
  assert(result.matches.length === expected.matchCount, `${key}: quantidade de partidas incorreta`);
  assert(result.intent.match_count === expected.matchCount, `${key}: match_count efetivo incorreto`);
  assert(result.intent.metric === expected.metric, `${key}: métrica incorreta`);
  assert(result.intent.aggregation === expected.aggregation, `${key}: agregação incorreta`);
  assert(result.intent.venue === expected.venue, `${key}: mando efetivo incorreto`);

  if (expected.venue !== "all") {
    assert(
      result.matches.every((match) => match.venue === expected.venue),
      `${key}: amostra contém mando diferente do solicitado`,
    );
  }

  const calculated = expectedHeadline(result);
  assert(result.answer.value === calculated, `${key}: cálculo final diverge dos valores individuais`);
}

function printResult(key: string, input: AnalysisRequest, result: AnalysisResult): void {
  console.info(
    `PHASE2A_CASE_${key} ${JSON.stringify({
      question: input.question,
      overrides: input.overrides ?? null,
      provider: result.source.provider,
      metric: result.intent.metric,
      aggregation: result.intent.aggregation,
      match_count: result.intent.match_count,
      competition: result.intent.competition,
      venue: result.intent.venue,
      fixtures: result.matches.map((match) => ({
        fixture_id: match.id,
        date: match.date,
        opponent: match.opponent,
        venue: match.venue,
        competition: match.competition,
        value: match.value,
      })),
      statistics: result.statistics,
      final_value: result.answer.value,
    })}`,
  );
}

async function runCase(
  key: string,
  input: AnalysisRequest,
  expected: ExpectedCase,
): Promise<AnalysisResult> {
  const outcome = await analyzeQuestionServer(input);
  assert(outcome.ok, `${key}: ${outcome.ok ? "" : `${outcome.code}: ${outcome.reason}`}`);
  validateResult(key, outcome.result, expected);
  printResult(key, input, outcome.result);
  return outcome.result;
}

const failures: string[] = [];

for (const [key, testCase] of Object.entries(CASES)) {
  try {
    await runCase(key, testCase.input, testCase.expected);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failures.push(`${key}: ${reason}`);
    console.error(`PHASE2A_CASE_${key}_FAILED ${reason}`);
  }
}

try {
  const scoutingInput: AnalysisRequest = {
    question: "Qual o total de gols do Corinthians nos últimos 20 jogos?",
    overrides: { match_count: 20 },
  };
  const scouting = await analyzeQuestionServer(scoutingInput);
  assert(scouting.ok, `G scouting: ${scouting.ok ? "" : `${scouting.code}: ${scouting.reason}`}`);

  const counts = new Map<string, number>();
  for (const match of scouting.result.matches) {
    counts.set(match.competition, (counts.get(match.competition) ?? 0) + 1);
  }

  const competition = [...counts.entries()]
    .filter(([name, count]) => count >= 5 && normalize(name) !== "competicao")
    .sort((a, b) => b[1] - a[1])[0]?.[0];
  assert(competition, "G: nenhuma competição real possui pelo menos 5 partidas na janela consultada");

  const input: AnalysisRequest = {
    question: "Qual a média de escanteios do Corinthians nos últimos 5 jogos?",
    overrides: { match_count: 5, competition },
  };
  const result = await runCase("G", input, {
    matchCount: 5,
    metric: "corners",
    aggregation: "average",
    venue: "all",
  });
  assert(
    result.matches.every((match) => normalize(match.competition) === normalize(competition)),
    "G: alguma partida pertence a outra competição",
  );
  console.info(`PHASE2A_G_COMPETITION ${JSON.stringify({ competition, availableInLast20: counts.get(competition) })}`);
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  failures.push(`G: ${reason}`);
  console.error(`PHASE2A_CASE_G_FAILED ${reason}`);
}

try {
  const overrideOutcome = await analyzeQuestionServer({
    question: "Qual a média de gols do Corinthians?",
    overrides: { match_count: 20, venue: "all", competition: null },
  });
  assert(overrideOutcome.ok, "override: análise falhou");
  assert(overrideOutcome.result.intent.match_count === 20, "override: match_count da UI não prevaleceu");
  assert(overrideOutcome.result.statistics.sample_size === 20, "override: amostra não contém 20 partidas");
  console.info(
    `PHASE2A_OVERRIDE_PRECEDENCE ${JSON.stringify({
      match_count: overrideOutcome.result.intent.match_count,
      sample_size: overrideOutcome.result.statistics.sample_size,
      competition: overrideOutcome.result.intent.competition,
      venue: overrideOutcome.result.intent.venue,
    })}`,
  );
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  failures.push(`override: ${reason}`);
  console.error(`PHASE2A_OVERRIDE_PRECEDENCE_FAILED ${reason}`);
}

try {
  const unsupported = await analyzeQuestionServer({
    question: "Qual a média de escanteios do Corinthians nos últimos 30 jogos?",
  });
  assert(!unsupported.ok, "30 jogos: consulta deveria ser rejeitada");
  assert(unsupported.code === "UNSUPPORTED_FILTER", `30 jogos: código inesperado ${unsupported.code}`);
  console.info(
    `PHASE2A_PERIOD_30_REJECTED ${JSON.stringify({ code: unsupported.code, reason: unsupported.reason })}`,
  );
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error);
  failures.push(`30 jogos: ${reason}`);
  console.error(`PHASE2A_PERIOD_30_FAILED ${reason}`);
}

if (failures.length > 0) {
  throw new Error(`Phase 2A validation failed: ${failures.join(" | ")}`);
}

console.info("PHASE2A_VALIDATION_COMPLETE all checks passed");
