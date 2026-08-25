import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";

export interface ResolvedTeam {
  id: number;
  name: string;
  country: string;
}

export interface TeamFixtureFilters {
  venue?: QueryIntentInput["venue"];
  competitionNames?: readonly string[] | null;
}

export interface SportsDataProvider {
  readonly name: string;
  resolveTeam(name: string): Promise<ResolvedTeam>;
  getRecentTeamFixtures(
    teamId: number,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<ProviderFixture[]>;
  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null>;
}

export interface ProviderFixture {
  id: number;
  date: string;
  timestamp: number;
  status: string;
  competition: string;
  competitionId?: string | null;
  seasonId?: string | null;
  country?: string | null;
  home: { id: number; name: string };
  away: { id: number; name: string };
  goals: { home: number | null; away: number | null };
}

const normalizeCompetitionName = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function fixtureMatchesFilters(
  fixture: ProviderFixture,
  teamId: number,
  filters?: TeamFixtureFilters,
): boolean {
  const venue = filters?.venue ?? "all";
  if (venue === "home" && fixture.home.id !== teamId) return false;
  if (venue === "away" && fixture.away.id !== teamId) return false;

  const competitionNames = filters?.competitionNames;
  if (competitionNames && competitionNames.length > 0) {
    const fixtureCompetition = normalizeCompetitionName(fixture.competition);
    const allowed = competitionNames.some(
      (name) => normalizeCompetitionName(name) === fixtureCompetition,
    );
    if (!allowed) return false;
  }

  return true;
}
