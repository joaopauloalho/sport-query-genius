import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { ProviderFixture, ResolvedTeam } from "../provider";

export interface CachedTeamIdentity extends ResolvedTeam {
  fetchedAt: string;
  fixturesFetchedAt: string | null;
  fixturesRequestedCount: number;
  fixturesReturnedCount: number;
}

export interface CachedMetricValue {
  value: number | null;
  sourceProvider: string;
  fetchedAt: string;
}

export interface SportsCacheRepository {
  getTeamByNormalizedName(
    provider: string,
    normalizedName: string,
  ): Promise<CachedTeamIdentity | null>;
  getTeamById(provider: string, teamId: number): Promise<CachedTeamIdentity | null>;
  upsertTeam(provider: string, team: ResolvedTeam): Promise<void>;
  listRecentFixtures(provider: string, teamId: number, limit: number): Promise<ProviderFixture[]>;
  upsertFixtures(provider: string, fixtures: readonly ProviderFixture[]): Promise<void>;
  markFixturesFetched(
    provider: string,
    teamId: number,
    requestedCount: number,
    returnedCount: number,
  ): Promise<void>;
  getMetric(
    provider: string,
    fixtureId: number,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<CachedMetricValue | null>;
  upsertMetric(params: {
    provider: string;
    fixtureId: number;
    teamId: number;
    metric: QueryIntentInput["metric"];
    value: number | null;
    sourceProvider: string;
  }): Promise<void>;
}
