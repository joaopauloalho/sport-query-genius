import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";

export interface ResolvedTeam {
  id: number;
  name: string;
  country: string;
}

export interface SportsDataProvider {
  readonly name: string;
  resolveTeam(name: string): Promise<ResolvedTeam>;
  getRecentTeamFixtures(teamId: number, count: number): Promise<ProviderFixture[]>;
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
  home: { id: number; name: string };
  away: { id: number; name: string };
  goals: { home: number | null; away: number | null };
}
