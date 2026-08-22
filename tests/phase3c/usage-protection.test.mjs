import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { analysisRequestSchema } from "../../src/lib/analysis-request.ts";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("A. analysis request requires an idempotency key and rejects client user_id", () => {
  const valid = analysisRequestSchema.safeParse({
    question: "Média de escanteios do Corinthians nos últimos 5 jogos?",
    idempotency_key: "11111111-1111-4111-8111-111111111111",
  });
  assert.equal(valid.success, true);

  const fakeUser = analysisRequestSchema.safeParse({
    question: "Média de escanteios do Corinthians nos últimos 5 jogos?",
    idempotency_key: "11111111-1111-4111-8111-111111111111",
    user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  });
  assert.equal(fakeUser.success, false);
});

test("B. Server Function validates bearer auth on the server before protected analysis", async () => {
  const source = await read("src/lib/analysis.functions.ts");
  assert.match(source, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(source, /validateAnalysisAuthorization\(request\.headers\.get\("authorization"\)\)/);
  assert.match(source, /executeProtectedAnalysis\(\{ request: data, auth: context\.analysisAuth \}\)/);
  assert.doesNotMatch(source, /analyzeQuestionServer\(data\)/);
});

test("C. server auth validates the token with Supabase Auth and never trusts getSession/user_metadata", async () => {
  const source = await read("src/server/auth/analysis-auth.server.ts");
  assert.match(source, /client\.auth\.getUser\(accessToken\)/);
  assert.doesNotMatch(source, /getSession\(/);
  assert.doesNotMatch(source, /user_metadata/);
  assert.doesNotMatch(source, /SUPABASE_SECRET_KEY/);
});

test("D. protected flow checks auth and usage gate before the expensive analyzer", async () => {
  const source = await read("src/server/analysis/protected-analysis.server.ts");
  const authCheck = source.indexOf('input.auth.status !== "authenticated"');
  const usageGate = source.indexOf("beginAnalysisUsage({");
  const expensiveAnalysis = source.indexOf("analyzeQuestionServer(input.request, telemetry)");
  assert.ok(authCheck >= 0);
  assert.ok(usageGate > authCheck);
  assert.ok(expensiveAnalysis > usageGate);
  assert.match(source, /"UNAUTHORIZED"/);
  assert.match(source, /"RATE_LIMITED"/);
  assert.match(source, /"QUOTA_EXCEEDED"/);
  assert.match(source, /"ANALYSIS_IN_PROGRESS"/);
});

test("E. migration makes usage server-authoritative, RLS-isolated and atomically guarded", async () => {
  const sql = await read("supabase/migrations/20260822023000_phase3c_server_usage_protection.sql");
  assert.match(sql, /create table if not exists public\.analysis_usage_events/i);
  assert.match(sql, /alter table public\.analysis_usage_events enable row level security/i);
  assert.match(sql, /create policy analysis_usage_select_own/i);
  assert.match(sql, /\(select auth\.uid\(\)\) = user_id/i);
  assert.match(sql, /revoke all on table public\.analysis_usage_events from anon, authenticated, service_role/i);
  assert.match(sql, /grant select on table public\.analysis_usage_events to authenticated/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete)[^;]*authenticated/i);
  assert.match(sql, /revoke insert, update on table public\.analysis_history from authenticated/i);
  assert.match(sql, /pg_advisory_xact_lock/i);
  assert.match(sql, /analysis_usage_user_idempotency_uidx/i);
  assert.match(sql, /security invoker/gi);
  assert.match(sql, /revoke all on function public\.begin_analysis_usage[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.begin_analysis_usage[\s\S]*to service_role/i);
});

test("F. usage foundation has configurable anti-abuse controls and no hardcoded commercial quota", async () => {
  const source = await read("src/server/analysis/usage.server.ts");
  for (const name of [
    "ANALYSIS_RATE_LIMIT_MAX",
    "ANALYSIS_RATE_LIMIT_WINDOW_SECONDS",
    "ANALYSIS_MAX_CONCURRENT_PER_USER",
    "ANALYSIS_LEASE_SECONDS",
    "ANALYSIS_QUOTA_LIMIT",
    "ANALYSIS_QUOTA_WINDOW_SECONDS",
  ]) {
    assert.match(source, new RegExp(name));
  }
  assert.match(source, /quotaLimit: number \| null/);
  assert.match(source, /SUPABASE_SECRET_KEY/);
});

test("G. history is completed server-side and the result page no longer invents history", async () => {
  const sql = await read("supabase/migrations/20260822023000_phase3c_server_usage_protection.sql");
  const route = await read("src/routes/app.resultado.tsx");
  assert.match(sql, /insert into public\.analysis_history/i);
  assert.match(sql, /analysis_history_id = v_history_id/i);
  assert.match(route, /refreshUserData/);
  assert.doesNotMatch(route, /registerAnalysis\(/);
});

test("H. cache telemetry is passive and preserves provider/cache regression architecture", async () => {
  const cached = await read("src/server/sports/cache/cached-provider.server.ts");
  const wrapper = await read("src/server/sports/cache/sports-cache.server.ts");
  assert.match(cached, /observer\?\.cacheHit/);
  assert.match(cached, /observer\?\.cacheMiss/);
  assert.match(cached, /observer\?\.providerCall/);
  assert.match(wrapper, /new CachedSportsDataProvider\(provider, cache, Date\.now, observer\)/);
});

test("I. client-facing Phase 3C files contain no Supabase secret/service-role credential", async () => {
  const clientSources = await Promise.all([
    read("src/lib/analysis.functions.ts"),
    read("src/lib/supabase-browser.ts"),
    read("src/routes/app.resultado.tsx"),
  ]);
  const clientText = clientSources.join("\n");
  assert.doesNotMatch(clientText, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(clientText, /sb_secret_/i);
  assert.doesNotMatch(clientText, /service_role/i);
});
