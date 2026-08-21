# Phase 3A — Sports data cache

## Scope

This phase adds a server-side Supabase cache for real football provider data. It does not add Auth, users, billing, workspaces, saved searches, players, tennis, basketball, or client-side Supabase access.

The deterministic analysis engine remains responsible for average, total, and median calculations. The cache stores provider data, never a question-to-result JSON shortcut.

## Runtime architecture

```text
Question
  -> DeepSeek intent + Zod validation
  -> overrides / filters
  -> FootballProviderOrchestrator
       -> FilteredSportsDataProvider
            -> CachedSportsDataProvider (BSD)
                 -> Supabase repository
                 -> BSD on miss/stale
       -> controlled fallback
       -> FilteredSportsDataProvider
            -> CachedSportsDataProvider (API-FOOTBALL)
                 -> Supabase repository
                 -> API-FOOTBALL on miss/stale
  -> deterministic calculation
  -> AnalysisResult
```

The cache wraps each provider independently. Provider IDs are never shared or translated in the cache. Cross-provider matching remains the responsibility of the existing conservative fallback orchestrator.

## Tables

The versioned migration creates only three tables:

- `sports_provider_teams`: provider-specific team identity plus fixture-feed freshness/coverage.
- `sports_fixtures`: provider-specific fixtures, competition, teams, score, status, and fetch timestamps.
- `sports_fixture_team_metrics`: one row per provider/fixture/team/metric, including metric source and freshness.

A metric row with `value = 0` means a real zero. A metric row with `value = null` means the provider was queried and did not provide a usable value. No row means the metric has not been fetched yet.

## Freshness policy

- Team identity: 30 days.
- Recent-fixture feed coverage: 30 minutes.
- Non-final fixture metric: 5 minutes.
- Fetched-but-missing metric (`null`): 1 hour.
- Final fixture within the last 48 hours: 6 hours.
- Older final fixture with a real value: 30 days.

Provider errors are never persisted as cache data. A stale row is refreshed through the real provider.

The fixture-feed row also records how many fixtures were requested and returned. This allows a fresh provider response that legitimately returned fewer rows than requested to remain reusable without turning `DATA_INSUFFICIENT` into success.

## Failure policy

Supabase is an optimization, not a dependency of correctness.

- Cache read failure: log a sanitized warning and call the real provider.
- Cache write failure: log a sanitized warning and keep the provider result.
- Provider failure: preserve the existing BSD -> API-Football fallback behavior; do not cache the failure.
- Missing metric: preserve `null` and existing `DATA_INSUFFICIENT` behavior; never synthesize a statistic.

No secret value is logged. Only provider name, operation, fixture/team IDs, metric name, counts, and a bounded error message are emitted.

## Server-side Supabase credentials

The implementation uses `@supabase/supabase-js` on the server only with:

- `SUPABASE_URL`
- `SUPABASE_SECRET_KEY`

The client disables auth session persistence, refresh, and URL-session detection. The secret key must never use a `VITE_` prefix or be exposed to browser code.

The migration enables RLS, creates no user policies, revokes table access from `anon`/`authenticated`, and grants the cache tables to `service_role`, which is the Postgres role used by Supabase backend secret keys.

## Observability

Structured server logs cover:

- cache hit
- cache miss
- cache stale
- provider called
- fixtures persisted
- statistic persisted
- cache read/write failure with provider fallback

Raw provider payloads and secrets are not logged by the cache layer.

## Validation

Automated Phase 3A tests prove:

1. empty cache -> provider call -> persistence;
2. second identical lookup -> cache hit -> no repeated provider call;
3. different aggregation over the same metric/fixtures reuses cached sports data;
4. real zero remains zero;
5. null remains missing;
6. stale data refreshes;
7. cache write failure does not invalidate a provider result;
8. BSD/API-Football hybrid provenance remains intact;
9. home/away/competition filtering still applies over cached fixture history;
10. missing statistics never get invented to complete a sample.

The existing Phase 2B suite remains part of Phase 3A CI. The strict lint gate is scoped to Phase 3A files touched by this change; the repository-wide lint is diagnostic only so legacy formatting debt is not silently expanded into this phase.

## Real Supabase validation status

At implementation time, the connected Supabase account did not expose a project clearly associated with `sport-query-genius`. The migration is therefore versioned in the repository but intentionally **not applied to any unrelated project**.

Once a dedicated project is connected, apply the migration, configure the two server-only environment variables, and validate with:

1. `Qual foi a média de escanteios do Corinthians nos últimos 5 jogos?`
2. Repeat the same query and confirm fixture/stat cache hits plus avoided provider calls.
3. `Qual foi o total de escanteios do Corinthians nos últimos 5 jogos?`
4. Confirm the same cached fixtures/stats are reused and only deterministic aggregation changes.
