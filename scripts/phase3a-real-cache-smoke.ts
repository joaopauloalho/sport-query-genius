// Temporary cold-cache rerun marker: 2026-08-21.
import { analyzeQuestionServer } from "../src/server/analysis/analyze.server.ts";

type CacheEvent = Record<string, unknown>;
type CacheTrace = {
  hits: CacheEvent[];
  misses: CacheEvent[];
  stale: CacheEvent[];
  providerCalls: CacheEvent[];
  fixturesPersisted: CacheEvent[];
  statisticsPersisted: CacheEvent[];
};

const emptyTrace = (): CacheTrace => ({
  hits: [],
  misses: [],
  stale: [],
  providerCalls: [],
  fixturesPersisted: [],
  statisticsPersisted: [],
});

if (process.env.VERCEL_ENV !== "preview") {
  console.info("[phase3a-smoke] skipped outside Vercel Preview");
  process.exit(0);
}

const envPresence = {
  supabaseUrl: Boolean(process.env.SUPABASE_URL?.trim()),
  supabaseSecretKey: Boolean(process.env.SUPABASE_SECRET_KEY?.trim()),
  deepseekKey: Boolean(process.env.DEEPSEEK_API_KEY?.trim()),
  bsdFootballKey: Boolean(process.env.BSD_FOOTBALL_KEY?.trim()),
  apiFootballKey: Boolean(process.env.API_FOOTBALL_KEY?.trim()),
};
console.info("[phase3a-smoke] env presence", envPresence);

if (!envPresence.supabaseUrl || !envPresence.supabaseSecretKey) {
  throw new Error("Phase 3A smoke requires SUPABASE_URL and SUPABASE_SECRET_KEY in Preview");
}

let currentTrace = emptyTrace();
const originalInfo = console.info.bind(console);
console.info = (...args: unknown[]) => {
  const [message, detail] = args;
  if (typeof message === "string" && detail && typeof detail === "object") {
    const event = detail as CacheEvent;
    if (message === "[sports-cache] hit") currentTrace.hits.push(event);
    if (message === "[sports-cache] miss") currentTrace.misses.push(event);
    if (message === "[sports-cache] stale") currentTrace.stale.push(event);
    if (message === "[sports-cache] provider called") currentTrace.providerCalls.push(event);
    if (message === "[sports-cache] fixtures persisted") currentTrace.fixturesPersisted.push(event);
    if (message === "[sports-cache] statistic persisted") currentTrace.statisticsPersisted.push(event);
  }
  originalInfo(...args);
};

async function execute(label: string, question: string) {
  currentTrace = emptyTrace();
  const outcome = await analyzeQuestionServer({ question });
  if (!outcome.ok) {
    throw new Error(`${label} failed: ${outcome.code}: ${outcome.reason}`);
  }

  const fixtureIds = outcome.result.matches.map((match) => match.id);
  const summary = {
    label,
    question,
    team: outcome.result.intent.entity_name,
    metric: outcome.result.intent.metric,
    aggregation: outcome.result.intent.aggregation,
    answer: outcome.result.answer.value,
    provider: outcome.result.source.provider,
    fixtureIds,
    hits: currentTrace.hits.map((event) => ({
      provider: event.provider,
      kind: event.kind,
      fixtureId: event.fixtureId,
      metric: event.metric,
    })),
    misses: currentTrace.misses.map((event) => ({
      provider: event.provider,
      kind: event.kind,
      fixtureId: event.fixtureId,
      metric: event.metric,
    })),
    providerCalls: currentTrace.providerCalls.map((event) => ({
      provider: event.provider,
      operation: event.operation,
      fixtureId: event.fixtureId,
      metric: event.metric,
    })),
    fixturesPersisted: currentTrace.fixturesPersisted.length,
    statisticsPersisted: currentTrace.statisticsPersisted.length,
  };
  originalInfo("[phase3a-smoke] result", summary);
  return { outcome: outcome.result, trace: structuredClone(currentTrace), fixtureIds };
}

const averageQuestion = "Qual foi a média de escanteios do Corinthians nos últimos 5 jogos?";
const totalQuestion = "Qual foi o total de escanteios do Corinthians nos últimos 5 jogos?";

const first = await execute("average-first", averageQuestion);
const second = await execute("average-second", averageQuestion);
const third = await execute("total-reuse", totalQuestion);

const sameFixtures = (a: string[], b: string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

if (first.trace.providerCalls.length === 0) {
  throw new Error("First execution did not exercise a real sports provider call");
}
if (second.trace.providerCalls.length !== 0) {
  throw new Error("Second identical execution repeated sports provider calls instead of using cache");
}
if (third.trace.providerCalls.length !== 0) {
  throw new Error("Total execution repeated sports provider calls instead of reusing cache");
}
if (!sameFixtures(first.fixtureIds, second.fixtureIds) || !sameFixtures(first.fixtureIds, third.fixtureIds)) {
  throw new Error("Fixture IDs changed between average/average/total cache validation runs");
}
if (first.outcome.intent.aggregation !== "average" || third.outcome.intent.aggregation !== "total") {
  throw new Error("Deterministic aggregation did not change from average to total as expected");
}

originalInfo("[phase3a-smoke] PASS", {
  sameFixturesAcrossRuns: true,
  firstProviderCalls: first.trace.providerCalls.length,
  secondProviderCalls: second.trace.providerCalls.length,
  totalProviderCalls: third.trace.providerCalls.length,
  secondCacheHits: second.trace.hits.length,
  totalCacheHits: third.trace.hits.length,
});
