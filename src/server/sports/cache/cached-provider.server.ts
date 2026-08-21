import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { ProviderFixture, ResolvedTeam, SportsDataProvider } from "../provider";
import {
  SPORTS_CACHE_TTL_MS,
  isFreshTimestamp,
  metricTtlMs,
  normalizeCacheName,
} from "./cache-policy";
import type { SportsCacheRepository } from "./repository";

type CacheRead<T> = { ok: true; value: T } | { ok: false };

function buildMatchRecord(
  fixture: ProviderFixture,
  teamId: number,
  value: number,
  source: string,
): MatchRecord | null {
  const isHome = fixture.home.id === teamId;
  const isAway = fixture.away.id === teamId;
  if (!isHome && !isAway) return null;

  const goalsFor = isHome ? fixture.goals.home : fixture.goals.away;
  const goalsAgainst = isHome ? fixture.goals.away : fixture.goals.home;
  if (goalsFor === null || goalsAgainst === null) return null;

  return {
    id: String(fixture.id),
    date: fixture.date,
    opponent: isHome ? fixture.away.name : fixture.home.name,
    competition: fixture.competition,
    venue: isHome ? "home" : "away",
    result: `${fixture.goals.home ?? "-"}-${fixture.goals.away ?? "-"}`,
    outcome: goalsFor > goalsAgainst ? "V" : goalsFor < goalsAgainst ? "D" : "E",
    value,
    source,
  };
}

export class CachedSportsDataProvider implements SportsDataProvider {
  private readonly resolveInflight = new Map<string, Promise<ResolvedTeam>>();
  private readonly fixturesInflight = new Map<string, Promise<ProviderFixture[]>>();
  private readonly metricInflight = new Map<string, Promise<MatchRecord | null>>();

  constructor(
    private readonly delegate: SportsDataProvider,
    private readonly repository: SportsCacheRepository,
    private readonly now: () => number = Date.now,
  ) {}

  get name(): string {
    return this.delegate.name;
  }

  private async readCache<T>(
    operation: string,
    identity: Record<string, string | number>,
    read: () => Promise<T>,
  ): Promise<CacheRead<T>> {
    try {
      return { ok: true, value: await read() };
    } catch (error) {
      console.warn("[sports-cache] read failed; bypassing cache", {
        provider: this.name,
        operation,
        ...identity,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
      return { ok: false };
    }
  }

  private async writeCache(
    operation: string,
    identity: Record<string, string | number>,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      console.warn("[sports-cache] write failed; provider result kept", {
        provider: this.name,
        operation,
        ...identity,
        error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
      });
    }
  }

  resolveTeam(name: string): Promise<ResolvedTeam> {
    const normalizedName = normalizeCacheName(name);
    const existing = this.resolveInflight.get(normalizedName);
    if (existing) return existing;

    const promise = (async () => {
      const cached = await this.readCache("team", { normalizedName }, () =>
        this.repository.getTeamByNormalizedName(this.name, normalizedName),
      );

      if (cached.ok && cached.value) {
        if (isFreshTimestamp(cached.value.fetchedAt, SPORTS_CACHE_TTL_MS.teamIdentity, this.now())) {
          console.info("[sports-cache] hit", {
            provider: this.name,
            kind: "team",
            teamId: cached.value.id,
          });
          return {
            id: cached.value.id,
            name: cached.value.name,
            country: cached.value.country,
          };
        }
        console.info("[sports-cache] stale", {
          provider: this.name,
          kind: "team",
          teamId: cached.value.id,
        });
      } else if (cached.ok) {
        console.info("[sports-cache] miss", {
          provider: this.name,
          kind: "team",
          normalizedName,
        });
      }

      console.info("[sports-cache] provider called", {
        provider: this.name,
        operation: "resolveTeam",
      });
      const team = await this.delegate.resolveTeam(name);
      await this.writeCache("team", { teamId: team.id }, () =>
        this.repository.upsertTeam(this.name, team),
      );
      return team;
    })();

    this.resolveInflight.set(normalizedName, promise);
    return promise;
  }

  getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]> {
    const inflightKey = `${teamId}:${count}`;
    const existing = this.fixturesInflight.get(inflightKey);
    if (existing) return existing;

    const promise = (async () => {
      const teamState = await this.readCache("fixture-feed", { teamId }, () =>
        this.repository.getTeamById(this.name, teamId),
      );

      if (teamState.ok && teamState.value) {
        const feedFresh = isFreshTimestamp(
          teamState.value.fixturesFetchedAt,
          SPORTS_CACHE_TTL_MS.fixtureFeed,
          this.now(),
        );
        const coverageValid = teamState.value.fixturesRequestedCount >= count;

        if (feedFresh && coverageValid) {
          const cachedFixtures = await this.readCache("fixtures", { teamId, count }, () =>
            this.repository.listRecentFixtures(this.name, teamId, count),
          );
          if (cachedFixtures.ok) {
            const expected = Math.min(teamState.value.fixturesReturnedCount, count);
            if (cachedFixtures.value.length >= expected) {
              console.info("[sports-cache] hit", {
                provider: this.name,
                kind: "fixtures",
                teamId,
                requested: count,
                returned: cachedFixtures.value.length,
              });
              return cachedFixtures.value.slice(-count);
            }
          }
        }

        if (teamState.value.fixturesFetchedAt) {
          console.info("[sports-cache] stale", {
            provider: this.name,
            kind: "fixtures",
            teamId,
            requested: count,
            previousRequested: teamState.value.fixturesRequestedCount,
          });
        } else {
          console.info("[sports-cache] miss", {
            provider: this.name,
            kind: "fixtures",
            teamId,
            requested: count,
          });
        }
      } else if (teamState.ok) {
        console.info("[sports-cache] miss", {
          provider: this.name,
          kind: "fixtures",
          teamId,
          requested: count,
        });
      }

      console.info("[sports-cache] provider called", {
        provider: this.name,
        operation: "getRecentTeamFixtures",
        teamId,
        requested: count,
      });
      const fixtures = await this.delegate.getRecentTeamFixtures(teamId, count);

      await this.writeCache("fixtures", { teamId, count: fixtures.length }, () =>
        this.repository.upsertFixtures(this.name, fixtures),
      );
      await this.writeCache("fixture-feed", { teamId, requested: count }, () =>
        this.repository.markFixturesFetched(this.name, teamId, count, fixtures.length),
      );

      console.info("[sports-cache] fixtures persisted", {
        provider: this.name,
        teamId,
        count: fixtures.length,
      });
      return fixtures;
    })();

    this.fixturesInflight.set(inflightKey, promise);
    return promise;
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    const inflightKey = `${fixture.id}:${teamId}:${metric}`;
    const existing = this.metricInflight.get(inflightKey);
    if (existing) return existing;

    const promise = (async () => {
      const cached = await this.readCache("metric", { fixtureId: fixture.id, teamId, metric }, () =>
        this.repository.getMetric(this.name, fixture.id, teamId, metric),
      );

      if (cached.ok && cached.value) {
        const ttlMs = metricTtlMs(fixture, cached.value.value, this.now());
        if (isFreshTimestamp(cached.value.fetchedAt, ttlMs, this.now())) {
          console.info("[sports-cache] hit", {
            provider: this.name,
            kind: "metric",
            fixtureId: fixture.id,
            teamId,
            metric,
            hasValue: cached.value.value !== null,
          });
          return cached.value.value === null
            ? null
            : buildMatchRecord(fixture, teamId, cached.value.value, cached.value.sourceProvider);
        }

        console.info("[sports-cache] stale", {
          provider: this.name,
          kind: "metric",
          fixtureId: fixture.id,
          teamId,
          metric,
        });
      } else if (cached.ok) {
        console.info("[sports-cache] miss", {
          provider: this.name,
          kind: "metric",
          fixtureId: fixture.id,
          teamId,
          metric,
        });
      }

      console.info("[sports-cache] provider called", {
        provider: this.name,
        operation: "getFixtureMetric",
        fixtureId: fixture.id,
        teamId,
        metric,
      });
      const record = await this.delegate.getFixtureMetric(fixture, teamId, metric);
      const value = record?.value ?? null;
      const sourceProvider = record?.source ?? this.name;

      await this.writeCache("metric", { fixtureId: fixture.id, teamId, metric }, () =>
        this.repository.upsertMetric({
          provider: this.name,
          fixtureId: fixture.id,
          teamId,
          metric,
          value,
          sourceProvider,
        }),
      );
      console.info("[sports-cache] statistic persisted", {
        provider: this.name,
        fixtureId: fixture.id,
        teamId,
        metric,
        hasValue: value !== null,
      });
      return record;
    })();

    this.metricInflight.set(inflightKey, promise);
    return promise;
  }
}
