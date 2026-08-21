import type { SportsDataProvider } from "../provider";
import { CachedSportsDataProvider } from "./cached-provider.server";
import type { SportsCacheRepository } from "./repository";
import { createSupabaseSportsCacheRepositoryFromEnv } from "./supabase-repository.server";

let repository: SportsCacheRepository | null | undefined;

export function getSportsCacheRepository(): SportsCacheRepository | null {
  if (repository === undefined) {
    repository = createSupabaseSportsCacheRepositoryFromEnv();
  }
  return repository;
}

export function withSportsCache(provider: SportsDataProvider): SportsDataProvider {
  const cache = getSportsCacheRepository();
  return cache ? new CachedSportsDataProvider(provider, cache) : provider;
}
