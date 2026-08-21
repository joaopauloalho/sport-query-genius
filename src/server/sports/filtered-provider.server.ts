import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import {
  fixtureMatchesFilters,
  type ProviderFixture,
  type ResolvedTeam,
  type SportsDataProvider,
  type TeamFixtureFilters,
} from "./provider.ts";

const FILTERED_HISTORY_LIMIT = 200;

function hasFixtureFilters(filters?: TeamFixtureFilters): boolean {
  return Boolean(
    (filters?.venue && filters.venue !== "all") ||
    (filters?.competitionNames && filters.competitionNames.length > 0),
  );
}

export class FilteredSportsDataProvider implements SportsDataProvider {
  readonly name: string;

  constructor(private readonly delegate: SportsDataProvider) {
    this.name = delegate.name;
  }

  resolveTeam(name: string): Promise<ResolvedTeam> {
    return this.delegate.resolveTeam(name);
  }

  async getRecentTeamFixtures(
    teamId: number,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<ProviderFixture[]> {
    const historyCount = hasFixtureFilters(filters) ? FILTERED_HISTORY_LIMIT : count;
    const history = await this.delegate.getRecentTeamFixtures(teamId, historyCount);
    const selected = history.filter((fixture) => fixtureMatchesFilters(fixture, teamId, filters));

    console.info("[sports-provider] fixture filters applied", {
      provider: this.name,
      teamId,
      requested: count,
      historyCount: history.length,
      matched: selected.length,
      venue: filters?.venue ?? "all",
      competitions: filters?.competitionNames ?? null,
      selectedIds: selected.slice(-count).map((fixture) => fixture.id),
    });

    return selected.slice(-count);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}
