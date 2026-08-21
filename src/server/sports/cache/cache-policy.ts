import type { ProviderFixture } from "../provider";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const SPORTS_CACHE_TTL_MS = {
  teamIdentity: 30 * DAY_MS,
  fixtureFeed: 30 * MINUTE_MS,
  metricUnfinished: 5 * MINUTE_MS,
  metricMissing: HOUR_MS,
  metricRecentFinal: 6 * HOUR_MS,
  metricHistoricalFinal: 30 * DAY_MS,
  recentFixtureWindow: 48 * HOUR_MS,
} as const;

const FINAL_STATUSES = new Set([
  "finished",
  "ft",
  "aet",
  "pen",
  "match finished",
  "after extra time",
  "penalties",
]);

export function normalizeCacheName(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isFreshTimestamp(
  fetchedAt: string | null | undefined,
  ttlMs: number,
  nowMs = Date.now(),
): boolean {
  if (!fetchedAt) return false;
  const fetchedMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedMs)) return false;
  const ageMs = nowMs - fetchedMs;
  return ageMs >= 0 && ageMs <= ttlMs;
}

export function isFinalFixtureStatus(status: string): boolean {
  return FINAL_STATUSES.has(status.trim().toLowerCase());
}

export function metricTtlMs(
  fixture: Pick<ProviderFixture, "status" | "timestamp">,
  value: number | null,
  nowMs = Date.now(),
): number {
  if (value === null) return SPORTS_CACHE_TTL_MS.metricMissing;
  if (!isFinalFixtureStatus(fixture.status)) return SPORTS_CACHE_TTL_MS.metricUnfinished;

  const fixtureAgeMs = nowMs - fixture.timestamp * 1000;
  if (fixtureAgeMs >= 0 && fixtureAgeMs <= SPORTS_CACHE_TTL_MS.recentFixtureWindow) {
    return SPORTS_CACHE_TTL_MS.metricRecentFinal;
  }

  return SPORTS_CACHE_TTL_MS.metricHistoricalFinal;
}
