import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { normalizeFootballEntityName } from "./entity-resolver";
import type { PlayerFixtureStat, PlayerGoalEvent, ResolvedPlayer } from "./player-provider";
import type { FootballEntityType } from "./verified-aliases";

const ALIASES_TABLE = "sports_entity_aliases";
const PLAYERS_TABLE = "sports_provider_players";
const PLAYER_STATS_TABLE = "sports_player_fixture_stats";
const PLAYER_EVENTS_TABLE = "sports_player_events";

export interface PersistedEntityAlias {
  provider: string;
  entityType: FootballEntityType;
  alias: string;
  normalizedAlias: string;
  providerEntityId: number;
  canonicalName: string;
  confidence: number;
  source: string;
}

export interface CachedPlayerIdentity extends ResolvedPlayer {
  fetchedAt: string;
  statsFetchedAt: string | null;
  statsRequestedCount: number;
  statsReturnedCount: number;
  eventsFetchedAt: string | null;
}

export interface Phase3dSportsRepository {
  getAlias(
    provider: string,
    entityType: FootballEntityType,
    alias: string,
  ): Promise<PersistedEntityAlias | null>;
  upsertAlias(alias: PersistedEntityAlias): Promise<void>;
  getPlayerById(provider: string, playerId: number): Promise<CachedPlayerIdentity | null>;
  getPlayerByNormalizedName(
    provider: string,
    normalizedName: string,
  ): Promise<CachedPlayerIdentity | null>;
  upsertPlayer(provider: string, player: ResolvedPlayer): Promise<void>;
  listRecentPlayerStats(
    provider: string,
    playerId: number,
    limit: number,
  ): Promise<PlayerFixtureStat[]>;
  upsertPlayerStats(
    provider: string,
    playerId: number,
    stats: readonly PlayerFixtureStat[],
  ): Promise<void>;
  markPlayerStatsFetched(
    provider: string,
    playerId: number,
    requestedCount: number,
    returnedCount: number,
  ): Promise<void>;
  listPlayerGoalEvents(
    provider: string,
    playerId: number,
    limit: number,
  ): Promise<PlayerGoalEvent[]>;
  upsertPlayerEvents(
    provider: string,
    playerId: number,
    events: readonly PlayerGoalEvent[],
  ): Promise<void>;
  markPlayerEventsFetched(provider: string, playerId: number): Promise<void>;
}

function asNumber(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("Phase 3D cache returned a non-numeric value");
  return parsed;
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : asNumber(value);
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function fail(operation: string, error: { message: string } | null): void {
  if (error) throw new Error(`Supabase Phase 3D cache ${operation} failed: ${error.message}`);
}

function mapPlayer(row: Record<string, unknown>): CachedPlayerIdentity {
  return {
    id: asNumber(row.provider_player_id),
    name: String(row.name ?? ""),
    teamId: nullableNumber(row.current_provider_team_id),
    teamName: nullableString(row.current_team_name),
    position: nullableString(row.position),
    country: String(row.country ?? ""),
    fetchedAt: String(row.fetched_at),
    statsFetchedAt: nullableString(row.stats_fetched_at),
    statsRequestedCount: asNumber(row.stats_requested_count ?? 0),
    statsReturnedCount: asNumber(row.stats_returned_count ?? 0),
    eventsFetchedAt: nullableString(row.events_fetched_at),
  };
}

function mapPlayerStat(row: Record<string, unknown>): PlayerFixtureStat {
  return {
    fixtureId: asNumber(row.provider_fixture_id),
    date: String(row.kickoff_at),
    timestamp: asNumber(row.fixture_timestamp),
    competition: String(row.competition ?? "Competição"),
    teamId: nullableNumber(row.team_provider_id),
    teamName: nullableString(row.team_name),
    opponentId: nullableNumber(row.opponent_provider_id),
    opponentName: String(row.opponent_name ?? "Adversário"),
    venue: row.venue === "away" ? "away" : "home",
    result: String(row.result ?? ""),
    minutes: nullableNumber(row.minutes),
    goals: nullableNumber(row.goals),
    assists: nullableNumber(row.assists),
    shots: nullableNumber(row.shots),
    shotsOnTarget: nullableNumber(row.shots_on_target),
    cards: nullableNumber(row.cards),
    shotmapCovered: row.shotmap_covered === true,
    shotmapCheckedAt: nullableString(row.shotmap_checked_at),
    source: String(row.source_provider ?? row.provider ?? ""),
    fetchedAt: String(row.fetched_at),
  };
}

function mapPlayerEvent(row: Record<string, unknown>): PlayerGoalEvent {
  return {
    eventKey: String(row.event_key),
    fixtureId: asNumber(row.provider_fixture_id),
    date: String(row.kickoff_at),
    timestamp: asNumber(row.fixture_timestamp),
    competition: String(row.competition ?? "Competição"),
    teamId: nullableNumber(row.team_provider_id),
    teamName: nullableString(row.team_name),
    opponentId: nullableNumber(row.opponent_provider_id),
    opponentName: String(row.opponent_name ?? "Adversário"),
    venue: row.venue === "away" ? "away" : "home",
    result: String(row.result ?? ""),
    minute: nullableNumber(row.minute),
    extraTime: nullableNumber(row.extra_time),
    situation: nullableString(row.situation),
    bodyPart: nullableString(row.body_part),
    xg: nullableNumber(row.xg),
    xgEstimated: typeof row.xg_estimated === "boolean" ? row.xg_estimated : null,
    source: String(row.source_provider ?? row.provider ?? ""),
    fetchedAt: String(row.fetched_at),
  };
}

export class SupabasePhase3dSportsRepository implements Phase3dSportsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async getAlias(
    provider: string,
    entityType: FootballEntityType,
    alias: string,
  ): Promise<PersistedEntityAlias | null> {
    const normalizedAlias = normalizeFootballEntityName(alias);
    const { data, error } = await this.client
      .from(ALIASES_TABLE)
      .select(
        "alias,normalized_alias,provider,entity_type,provider_entity_id,canonical_name,confidence,source",
      )
      .eq("sport", "football")
      .eq("provider", provider)
      .eq("entity_type", entityType)
      .eq("normalized_alias", normalizedAlias)
      .limit(1)
      .maybeSingle();
    fail("alias lookup", error);
    if (!data) return null;
    const row = data as Record<string, unknown>;
    return {
      provider: String(row.provider),
      entityType: row.entity_type === "player" ? "player" : "team",
      alias: String(row.alias),
      normalizedAlias: String(row.normalized_alias),
      providerEntityId: asNumber(row.provider_entity_id),
      canonicalName: String(row.canonical_name),
      confidence: asNumber(row.confidence),
      source: String(row.source),
    };
  }

  async upsertAlias(alias: PersistedEntityAlias): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from(ALIASES_TABLE).upsert(
      {
        sport: "football",
        entity_type: alias.entityType,
        alias: alias.alias,
        normalized_alias: normalizeFootballEntityName(alias.alias),
        provider: alias.provider,
        provider_entity_id: alias.providerEntityId,
        canonical_name: alias.canonicalName,
        confidence: alias.confidence,
        source: alias.source,
        updated_at: now,
      },
      { onConflict: "sport,entity_type,provider,normalized_alias" },
    );
    fail("alias upsert", error);
  }

  async getPlayerById(provider: string, playerId: number): Promise<CachedPlayerIdentity | null> {
    const { data, error } = await this.client
      .from(PLAYERS_TABLE)
      .select(
        "provider_player_id,name,current_provider_team_id,current_team_name,position,country,fetched_at,stats_fetched_at,stats_requested_count,stats_returned_count,events_fetched_at",
      )
      .eq("provider", provider)
      .eq("provider_player_id", playerId)
      .limit(1)
      .maybeSingle();
    fail("player id lookup", error);
    return data ? mapPlayer(data as Record<string, unknown>) : null;
  }

  async getPlayerByNormalizedName(
    provider: string,
    normalizedName: string,
  ): Promise<CachedPlayerIdentity | null> {
    const { data, error } = await this.client
      .from(PLAYERS_TABLE)
      .select(
        "provider_player_id,name,current_provider_team_id,current_team_name,position,country,fetched_at,stats_fetched_at,stats_requested_count,stats_returned_count,events_fetched_at",
      )
      .eq("provider", provider)
      .eq("normalized_name", normalizedName)
      .limit(1)
      .maybeSingle();
    fail("player name lookup", error);
    return data ? mapPlayer(data as Record<string, unknown>) : null;
  }

  async upsertPlayer(provider: string, player: ResolvedPlayer): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client.from(PLAYERS_TABLE).upsert(
      {
        provider,
        provider_player_id: player.id,
        name: player.name,
        normalized_name: normalizeFootballEntityName(player.name),
        current_provider_team_id: player.teamId,
        current_team_name: player.teamName,
        position: player.position,
        country: player.country,
        fetched_at: now,
        updated_at: now,
      },
      { onConflict: "provider,provider_player_id" },
    );
    fail("player upsert", error);
  }

  async listRecentPlayerStats(
    provider: string,
    playerId: number,
    limit: number,
  ): Promise<PlayerFixtureStat[]> {
    const { data, error } = await this.client
      .from(PLAYER_STATS_TABLE)
      .select("*")
      .eq("provider", provider)
      .eq("provider_player_id", playerId)
      .order("fixture_timestamp", { ascending: false })
      .limit(limit);
    fail("player stats lookup", error);
    return (data ?? []).map((row) => mapPlayerStat(row as Record<string, unknown>)).reverse();
  }

  async upsertPlayerStats(
    provider: string,
    playerId: number,
    stats: readonly PlayerFixtureStat[],
  ): Promise<void> {
    if (stats.length === 0) return;
    const now = new Date().toISOString();
    const rows = stats.map((stat) => ({
      provider,
      provider_fixture_id: stat.fixtureId,
      provider_player_id: playerId,
      kickoff_at: new Date(stat.timestamp * 1000).toISOString(),
      fixture_timestamp: stat.timestamp,
      competition: stat.competition,
      team_provider_id: stat.teamId,
      team_name: stat.teamName,
      opponent_provider_id: stat.opponentId,
      opponent_name: stat.opponentName,
      venue: stat.venue,
      result: stat.result,
      minutes: stat.minutes,
      goals: stat.goals,
      assists: stat.assists,
      shots: stat.shots,
      shots_on_target: stat.shotsOnTarget,
      cards: stat.cards,
      shotmap_covered: stat.shotmapCovered,
      shotmap_checked_at: stat.shotmapCheckedAt ?? null,
      source_provider: stat.source,
      fetched_at: stat.fetchedAt ?? now,
      updated_at: now,
    }));
    const { error } = await this.client
      .from(PLAYER_STATS_TABLE)
      .upsert(rows, { onConflict: "provider,provider_fixture_id,provider_player_id" });
    fail("player stats upsert", error);
  }

  async markPlayerStatsFetched(
    provider: string,
    playerId: number,
    requestedCount: number,
    returnedCount: number,
  ): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from(PLAYERS_TABLE)
      .update({
        stats_fetched_at: now,
        stats_requested_count: requestedCount,
        stats_returned_count: returnedCount,
        updated_at: now,
      })
      .eq("provider", provider)
      .eq("provider_player_id", playerId);
    fail("player stats marker", error);
  }

  async listPlayerGoalEvents(
    provider: string,
    playerId: number,
    limit: number,
  ): Promise<PlayerGoalEvent[]> {
    const { data, error } = await this.client
      .from(PLAYER_EVENTS_TABLE)
      .select("*")
      .eq("provider", provider)
      .eq("provider_player_id", playerId)
      .eq("event_type", "goal")
      .order("fixture_timestamp", { ascending: false })
      .order("minute", { ascending: false })
      .limit(limit);
    fail("player events lookup", error);
    return (data ?? []).map((row) => mapPlayerEvent(row as Record<string, unknown>));
  }

  async upsertPlayerEvents(
    provider: string,
    playerId: number,
    events: readonly PlayerGoalEvent[],
  ): Promise<void> {
    if (events.length === 0) return;
    const now = new Date().toISOString();
    const rows = events.map((event) => ({
      provider,
      provider_fixture_id: event.fixtureId,
      provider_player_id: playerId,
      event_key: event.eventKey,
      event_type: "goal",
      kickoff_at: new Date(event.timestamp * 1000).toISOString(),
      fixture_timestamp: event.timestamp,
      competition: event.competition,
      team_provider_id: event.teamId,
      team_name: event.teamName,
      opponent_provider_id: event.opponentId,
      opponent_name: event.opponentName,
      venue: event.venue,
      result: event.result,
      minute: event.minute,
      extra_time: event.extraTime,
      situation: event.situation,
      body_part: event.bodyPart,
      xg: event.xg,
      xg_estimated: event.xgEstimated,
      source_provider: event.source,
      fetched_at: event.fetchedAt ?? now,
      updated_at: now,
    }));
    const { error } = await this.client
      .from(PLAYER_EVENTS_TABLE)
      .upsert(rows, { onConflict: "provider,provider_player_id,event_key" });
    fail("player events upsert", error);
  }

  async markPlayerEventsFetched(provider: string, playerId: number): Promise<void> {
    const now = new Date().toISOString();
    const { error } = await this.client
      .from(PLAYERS_TABLE)
      .update({ events_fetched_at: now, updated_at: now })
      .eq("provider", provider)
      .eq("provider_player_id", playerId);
    fail("player events marker", error);
  }
}

let repository: Phase3dSportsRepository | null | undefined;

export function createPhase3dSportsRepositoryFromEnv(): Phase3dSportsRepository | null {
  const url = process.env.SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) return null;
  const client = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return new SupabasePhase3dSportsRepository(client);
}

export function getPhase3dSportsRepository(): Phase3dSportsRepository | null {
  if (repository === undefined) repository = createPhase3dSportsRepositoryFromEnv();
  return repository;
}
