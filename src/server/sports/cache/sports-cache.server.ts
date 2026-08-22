import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type {
  ProviderFixture,
  ResolvedTeam,
  SportsDataProvider,
  TeamFixtureFilters,
} from "../provider";
import type { SportsCacheObserver } from "./cache-observer";
import { CachedSportsDataProvider } from "./cached-provider.server";
import type { SportsCacheRepository } from "./repository";
import { createSupabaseSportsCacheRepositoryFromEnv } from "./supabase-repository.server";

let repository: SportsCacheRepository | null | undefined;

class ObservedSportsDataProvider implements SportsDataProvider {
  constructor(
    private readonly delegate: SportsDataProvider,
    private readonly observer: SportsCacheObserver,
  ) {}

  get name(): string {
    return this.delegate.name;
  }

  resolveTeam(name: string): Promise<ResolvedTeam> {
    this.observer.cacheMiss(this.name, "team");
    this.observer.providerCall(this.name, "resolveTeam");
    return this.delegate.resolveTeam(name);
  }

  getRecentTeamFixtures(
    teamId: number,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<ProviderFixture[]> {
    this.observer.cacheMiss(this.name, "fixtures");
    this.observer.providerCall(this.name, "getRecentTeamFixtures");
    return this.delegate.getRecentTeamFixtures(teamId, count, filters);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    this.observer.cacheMiss(this.name, "metric");
    this.observer.providerCall(this.name, "getFixtureMetric");
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}

export function getSportsCacheRepository(): SportsCacheRepository | null {
  if (repository === undefined) {
    repository = createSupabaseSportsCacheRepositoryFromEnv();
  }
  return repository;
}

export function withSportsCache(
  provider: SportsDataProvider,
  observer?: SportsCacheObserver,
): SportsDataProvider {
  const cache = getSportsCacheRepository();
  if (cache) return new CachedSportsDataProvider(provider, cache, Date.now, observer);
  return observer ? new ObservedSportsDataProvider(provider, observer) : provider;
}
