import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import type { ProviderFixture, ResolvedTeam } from "../provider";
import { normalizeCacheName } from "./cache-policy";
import type {
  CachedMetricValue,
  CachedTeamIdentity,
  SportsCacheRepository,
} from "./repository";

const TEAMS_TABLE = "sports_provider_teams";
const FIXTURES_TABLE = "sports_fixtures";
const METRICS_TABLE = "sports_fixture_team_metrics";

function fail(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`Supabase sports cache ${operation} failed: ${error.message}`);
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Supabase sports cache returned a non-numeric ID");
  return parsed;
}

function mapTeam(row: Record<string, unknown>): CachedTeamIdentity {
  return {
    id: asNumber(row.provider_team_id),
    name: String(row.name ?? ""),
    country: String(row.country ?? ""),
    fetchedAt: String(row.fetched_at),
    fixturesFetchedAt:
      typeof row.fixtures_fetched_at === "string" ? row.fixtures_fetched_at : null,
    fixturesRequestedCount: asNumber(row.fixtures_requested_count ?? 0),
    fixturesReturnedCount: asNumber(row.fixtures_returned_count ?? 0),
  };
}

function mapFixture(row: Record<string, unknown>): ProviderFixture {
  return {
    id: asNumber(row.provider_fixture_id),
    date: String(row.kickoff_at),
    timestamp: asNumber(row.fixture_timestamp),
    status: String(row.status ?? ""),
    competition: String(row.competition ?? "Competição"),
    home: {
      id: asNumber(row.home_provider_team_id),
      name: String(row.home_team_name ?? ""),
    },
    away: {
      id: asNumber(row.away_provider_team_id),
      name: String(row.away_team_name ?? ""),
    },
    goals: {
      home: row.home_goals === null ? null : asNumber(row.home_goals),
      away: row.away_goals === null ? null : asNumber(row.away_goals),
    },
  };
}

export class SupabaseSportsCacheRepository implements SportsCacheRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getTeamByNormalizedName(
    provider: string,
    normalizedName: string,
  ): Promise<CachedTeamIdentity | null> {
    const { data, error } = await this.client
      .from(TEAMS_TABLE)
      .select(
        "provider_team_id,name,country,fetched_at,fixtures_fetched_at,fixtures_requested_count,fixtures_returned_count",
      )
      .eq("provider", provider)
      .eq("normalized_name", normalizedName)
      .limit(1)
      .maybeSingle();
    fail("team lookup", error);
    return data ? mapTeam(data as Record<string, unknown>) : null;
  }

  async getTeamById(provider: string, teamId: number): Promise<CachedTeamIdentity | null> {
    const { data, error } = await this.client
      .from(TEAMS_TABLE)
      .select(
        "provider_team_id,name,country,fetched_at,fixtures_fetched_at,fixtures_requested_count,fixtures_returned_count",
      )
      .eq("provider", provider)
      .eq("provider_team_id", teamId)
      .limit(1)
      .maybeSingle();
    fail("team id lookup", error);
    return data ? mapTeam(data as Record<string, unknown>) : null;
  }

  async upsertTeam(provider: string, team: ResolvedTeam): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from(TEAMS_TABLE).upsert(
      {
        provider,
        provider_team_id: team.id,
        name: team.name,
        normalized_name: normalizeCacheName(team.name),
        country: team.country,
        fetched_at: now,
        updated_at: now,
      },
      { onConflict: "provider,provider_team_id" },
    );
    fail("team upsert", error);
  }

  async listRecentFixtures(
    provider: string,
    teamId: number,
    limit: number,
  ): Promise<ProviderFixture[]> {
    const { data, error } = await this.client
      .from(FIXTURES_TABLE)
      .select(
        "provider_fixture_id,kickoff_at,fixture_timestamp,status,competition,home_provider_team_id,home_team_name,away_provider_team_id,away_team_name,home_goals,away_goals",
      )
      .eq("provider", provider)
      .or(`home_provider_team_id.eq.${teamId},away_provider_team_id.eq.${teamId}`)
      .order("fixture_timestamp", { ascending: false })
      .limit(limit);
    fail("fixture lookup", error);

    return (data ?? [])
      .map((row) => mapFixture(row as Record<string, unknown>))
      .sort((a, b) => a.timestamp - b.timestamp);
  }

  async upsertFixtures(provider: string, fixtures: readonly ProviderFixture[]): Promise<void> {
    if (fixtures.length === 0) return;
    const now = new Date().toISOString();
    const rows = fixtures.map((fixture) => ({
      provider,
      provider_fixture_id: fixture.id,
      kickoff_at: new Date(fixture.timestamp * 1000).toISOString(),
      fixture_timestamp: fixture.timestamp,
      competition: fixture.competition,
      home_provider_team_id: fixture.home.id,
      home_team_name: fixture.home.name,
      away_provider_team_id: fixture.away.id,
      away_team_name: fixture.away.name,
      home_goals: fixture.goals.home,
      away_goals: fixture.goals.away,
      status: fixture.status,
      provider_updated_at: null,
      fetched_at: now,
      updated_at: now,
    }));

    const { error } = await this.client
      .from(FIXTURES_TABLE)
      .upsert(rows, { onConflict: "provider,provider_fixture_id" });
    fail("fixture upsert", error);
  }

  async markFixturesFetched(
    provider: string,
    teamId: number,
    requestedCount: number,
    returnedCount: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from(TEAMS_TABLE)
      .update({
        fixtures_fetched_at: now,
        fixtures_requested_count: requestedCount,
        fixtures_returned_count: returnedCount,
        updated_at: now,
      })
      .eq("provider", provider)
      .eq("provider_team_id", teamId);
    fail("fixture feed update", error);
  }

  async getMetric(
    provider: string,
    fixtureId: number,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<CachedMetricValue | null> {
    const { data, error } = await this.client
      .from(METRICS_TABLE)
      .select("value,source_provider,fetched_at")
      .eq("provider", provider)
      .eq("provider_fixture_id", fixtureId)
      .eq("team_provider_id", teamId)
      .eq("metric", metric)
      .limit(1)
      .maybeSingle();
    fail("metric lookup", error);
    if (!data) return null;

    const row = data as Record<string, unknown>;
    return {
      value: row.value === null ? null : asNumber(row.value),
      sourceProvider: String(row.source_provider ?? provider),
      fetchedAt: String(row.fetched_at),
    };
  }

  async upsertMetric(params: {
    provider: string;
    fixtureId: number;
    teamId: number;
    metric: QueryIntentInput["metric"];
    value: number | null;
    sourceProvider: string;
  }): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from(METRICS_TABLE).upsert(
      {
        provider: params.provider,
        provider_fixture_id: params.fixtureId,
        team_provider_id: params.teamId,
        metric: params.metric,
        value: params.value,
        source_provider: params.sourceProvider,
        fetched_at: now,
        updated_at: now,
      },
      {
        onConflict: "provider,provider_fixture_id,team_provider_id,metric",
      },
    );
    fail("metric upsert", error);
  }
}

export function createSupabaseSportsCacheRepositoryFromEnv(): SportsCacheRepository | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();

  if (!url || !secretKey) {
    console.info("[sports-cache] Supabase cache disabled", {
      hasUrl: Boolean(url),
      hasSecretKey: Boolean(secretKey),
    });
    return null;
  }

  const client = createClient(url, secretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return new SupabaseSportsCacheRepository(client);
}
