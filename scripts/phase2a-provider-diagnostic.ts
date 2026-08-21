import type { MatchRecord } from "@/data/sports";
import { FilteredSportsDataProvider } from "@/server/sports/filtered-provider.server";
import { ApiFootballProvider } from "@/server/sports/providers/api-football.server";
import { BsdFootballV3Provider } from "@/server/sports/providers/bsd-football-v3.server";
import type { ProviderFixture, SportsDataProvider } from "@/server/sports/provider";

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runWorker() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => runWorker()),
  );
  return results;
}

async function inspectProvider(label: string, provider: SportsDataProvider) {
  try {
    const filtered = new FilteredSportsDataProvider(provider);
    const team = await filtered.resolveTeam("Corinthians");

    for (const test of [
      { key: "B", count: 10, venue: "all" as const },
      { key: "D", count: 5, venue: "away" as const },
    ]) {
      const fixtures = await filtered.getRecentTeamFixtures(team.id, test.count, {
        venue: test.venue,
      });
      const metrics = await mapWithConcurrency<ProviderFixture, MatchRecord | null>(
        fixtures,
        4,
        (fixture) => filtered.getFixtureMetric(fixture, team.id, "corners"),
      );
      console.info(
        `PHASE2A_PROVIDER_${label}_${test.key} ${JSON.stringify({
          team: { id: team.id, name: team.name },
          fixtures: fixtures.map((fixture, index) => ({
            id: fixture.id,
            date: fixture.date,
            home: fixture.home.name,
            away: fixture.away.name,
            competition: fixture.competition,
            metric: metrics[index]?.value ?? null,
          })),
          missingFixtureIds: fixtures
            .filter((_, index) => metrics[index] === null)
            .map((fixture) => fixture.id),
        })}`,
      );
    }
  } catch (error) {
    console.error(
      `PHASE2A_PROVIDER_${label}_ERROR ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

await inspectProvider("BSD", new BsdFootballV3Provider());
await inspectProvider("API_FOOTBALL", new ApiFootballProvider());
