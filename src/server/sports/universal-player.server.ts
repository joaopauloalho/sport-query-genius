import { AnalysisPipelineError } from "../analysis/errors";
import type { SportsCacheObserver } from "./cache/cache-observer";
import type { CompetitionSeason } from "./competition-season-registry";
import {
  bsdPlayerStatTeamIds,
  extractBsdPlayerStatRows,
  normalizeApiFootballFixturePlayers,
  normalizeBsdPlayerMatchRows,
  type NormalizedPlayerMatchStats,
} from "./player-match-stats";
import { getProviderPayloadCacheRepository } from "./payload-cache.server";
import type { ProviderFixture, ResolvedTeam } from "./provider";
import type { ResolvedPlayer } from "./player-provider";
import { BsdPlayerProvider } from "./providers/bsd-player.server";
import { createUniversalFootballSources } from "./universal-provider.server";
import type {
  ProviderReadMeta,
  UniversalCompetitionSeasonRead,
  UniversalProviderName,
} from "./universal-football";
import {
  classifyApiFootballError,
  getApiFootballErrorPayload,
} from "./providers/api-football-errors";

const BSD_V2_BASE_URL = "https://sports.bzzoiro.com/api/v2";
const BSD_V1_BASE_URL = "https://sports.bzzoiro.com/api";
const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io";
const TIMEOUT_MS = 15_000;
const PLAYER_STATS_TTL_MS = 10 * 60 * 1000;
const FIXTURE_HISTORY = 100;
const MAX_PLAYER_TEAMS = 4;

interface PlayerSnapshotRead {
  player: ResolvedPlayer;
  snapshots: NormalizedPlayerMatchStats[];
  meta: ProviderReadMeta;
}

interface CachedSnapshots {
  player: ResolvedPlayer;
  snapshots: NormalizedPlayerMatchStats[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function readNumber(record: Record<string, unknown>, keys: readonly string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function bsdRowTeamName(row: Record<string, unknown>, teamId: number): string | null {
  const team = asRecord(row.team) ?? asRecord(row.club);
  if (team) {
    const id = readNumber(team, ["id", "team_id"]);
    const name = readString(team, ["name", "team_name"]);
    if ((id === null || id === teamId) && name) return name;
  }
  return readString(row, ["team_name", "club_name"]);
}

async function fetchJson(
  baseUrl: string,
  path: string,
  params: Record<string, string | number>,
  headers: Record<string, string>,
): Promise<{ payload: unknown; fetchedAt: string }> {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // handled below
    }
    if (response.status === 429) {
      throw new AnalysisPipelineError(
        "API_LIMIT_REACHED",
        "O limite do provider de futebol foi atingido.",
      );
    }
    if (!response.ok) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        `O provider de futebol recusou ${path} (HTTP ${response.status}).`,
      );
    }
    return { payload, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (error instanceof AnalysisPipelineError) throw error;
    throw new AnalysisPipelineError("PROVIDER_UNAVAILABLE", "O provider de futebol não respondeu.");
  } finally {
    clearTimeout(timeout);
  }
}

export class BsdUniversalPlayerSource {
  readonly name: UniversalProviderName = "BSD";
  private readonly playerProvider = new BsdPlayerProvider();
  private readonly footballSource;
  private readonly cache = getProviderPayloadCacheRepository();

  constructor(observer?: SportsCacheObserver) {
    const source = createUniversalFootballSources(observer, ["BSD"]).find(
      (item) => item.name === "BSD",
    );
    if (!source) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A fonte universal BSD não está configurada no servidor.",
      );
    }
    this.footballSource = source;
  }

  resolvePlayer(name: string): Promise<ResolvedPlayer> {
    return this.playerProvider.resolvePlayer(name);
  }

  async resolveCompetitionSeason(
    competition: string,
    season: string,
  ): Promise<UniversalCompetitionSeasonRead> {
    if (!this.footballSource.resolveCompetitionSeason) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        "A fonte BSD não possui resolução provider-backed de temporada.",
      );
    }
    return this.footballSource.resolveCompetitionSeason(competition, season);
  }

  private async loadBsdStats(
    playerId: number,
  ): Promise<{ payload: unknown; fetchedAt: string; endpoint: string }> {
    const key = `player:${playerId}:raw-v2`;
    const cached = await this.cache?.get<unknown>("BSD", "player_match_stats", key);
    if (cached) {
      return {
        payload: cached.payload,
        fetchedAt: cached.fetchedAt,
        endpoint: "/players/{player_id}/stats/",
      };
    }
    const apiKey = process.env.BSD_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A BSD Football API não está configurada no servidor.",
      );
    }
    const primary = await fetchJson(
      BSD_V2_BASE_URL,
      `/players/${playerId}/stats/`,
      { limit: 200, offset: 0 },
      { Authorization: `Token ${apiKey}` },
    );
    let payload = primary.payload;
    let fetchedAt = primary.fetchedAt;
    let endpoint = "/players/{player_id}/stats/";
    if (extractBsdPlayerStatRows(payload).length === 0) {
      const legacy = await fetchJson(
        BSD_V1_BASE_URL,
        "/player-stats/",
        { player: playerId, page: 1 },
        { Authorization: `Token ${apiKey}` },
      );
      payload = legacy.payload;
      fetchedAt = legacy.fetchedAt;
      endpoint = "/player-stats/";
    }
    await this.cache?.set({
      provider: "BSD",
      dataFamily: "player_match_stats",
      cacheKey: key,
      payload,
      ttlMs: PLAYER_STATS_TTL_MS,
    });
    return { payload, fetchedAt, endpoint };
  }

  async listPlayerSnapshots(player: ResolvedPlayer): Promise<PlayerSnapshotRead> {
    const normalizedKey = `player:${player.id}:normalized-v2`;
    const cached = await this.cache?.get<CachedSnapshots>(
      "BSD",
      "player_match_stats",
      normalizedKey,
    );
    if (cached) {
      return {
        player: cached.payload.player,
        snapshots: cached.payload.snapshots,
        meta: {
          provider: "BSD",
          endpoint: "/players/{player_id}/stats/ + /events/",
          dataFamily: "player_match_stats",
          fetchedAt: cached.fetchedAt,
          cacheStatus: "hit",
        },
      };
    }

    const statsRead = await this.loadBsdStats(player.id);
    const rawRows = extractBsdPlayerStatRows(statsRead.payload);
    const teamIds = bsdPlayerStatTeamIds(statsRead.payload, player.teamId).slice(
      0,
      MAX_PLAYER_TEAMS,
    );
    const teamNames = new Map<number, string>();
    for (const teamId of teamIds) {
      const rowName = rawRows.map((row) => bsdRowTeamName(row, teamId)).find(Boolean) ?? null;
      if (rowName) teamNames.set(teamId, rowName);
      else if (player.teamId === teamId && player.teamName) teamNames.set(teamId, player.teamName);
    }

    const fixtureReads = await Promise.all(
      teamIds.map((teamId) => {
        const team: ResolvedTeam = {
          id: teamId,
          name: teamNames.get(teamId) ?? `Team ${teamId}`,
          country: "",
        };
        return this.footballSource.listTeamFixtures(team, {
          last_matches: FIXTURE_HISTORY,
          venue: "all",
          half: "full",
          status: "finished",
        });
      }),
    );
    const byFixture = new Map<number, ProviderFixture>();
    for (const read of fixtureReads) {
      for (const fixture of read.fixtures) byFixture.set(fixture.id, fixture);
    }

    const snapshots = normalizeBsdPlayerMatchRows({
      rows: rawRows,
      fixtures: [...byFixture.values()],
      playerId: player.id,
      fallbackTeamId: player.teamId,
      fetchedAt: statsRead.fetchedAt,
    });
    const payload: CachedSnapshots = { player, snapshots };
    await this.cache?.set({
      provider: "BSD",
      dataFamily: "player_match_stats",
      cacheKey: normalizedKey,
      payload,
      ttlMs: PLAYER_STATS_TTL_MS,
    });

    const cacheStatuses = fixtureReads.map((read) => read.meta.cacheStatus);
    return {
      player,
      snapshots,
      meta: {
        provider: "BSD",
        endpoint: `${statsRead.endpoint} + /events/`,
        dataFamily: "player_match_stats",
        fetchedAt: statsRead.fetchedAt,
        cacheStatus:
          cacheStatuses.length > 0 && cacheStatuses.every((status) => status === "hit")
            ? "mixed"
            : "miss",
      },
    };
  }
}

export class ApiFootballPlayerMatchStatsAdapter {
  readonly name: UniversalProviderName = "API-FOOTBALL";
  private readonly cache = getProviderPayloadCacheRepository();

  private async requestFixturePlayers(
    fixtureId: number,
  ): Promise<{ payload: unknown; fetchedAt: string }> {
    const key = `fixture:${fixtureId}`;
    const cached = await this.cache?.get<unknown>("API-FOOTBALL", "player_match_stats", key);
    if (cached) return { payload: cached.payload, fetchedAt: cached.fetchedAt };
    const apiKey = process.env.API_FOOTBALL_KEY;
    if (!apiKey) {
      throw new AnalysisPipelineError(
        "PROVIDER_UNAVAILABLE",
        "A API-FOOTBALL não está configurada no servidor.",
      );
    }

    const perform = async (rapidApi: boolean) =>
      fetchJson(
        API_FOOTBALL_BASE_URL,
        "/fixtures/players",
        { fixture: fixtureId },
        rapidApi
          ? { "x-rapidapi-key": apiKey, "x-rapidapi-host": "v3.football.api-sports.io" }
          : { "x-apisports-key": apiKey },
      );

    let read = await perform(false);
    let errors = getApiFootballErrorPayload(read.payload);
    if (errors !== null) {
      const kind = classifyApiFootballError(errors);
      if (kind === "auth") {
        read = await perform(true);
        errors = getApiFootballErrorPayload(read.payload);
      }
      if (errors !== null) {
        const finalKind = classifyApiFootballError(errors);
        throw new AnalysisPipelineError(
          finalKind === "limit" ? "API_LIMIT_REACHED" : "PROVIDER_UNAVAILABLE",
          finalKind === "account"
            ? "A conta da API-FOOTBALL está suspensa, desativada ou inativa."
            : finalKind === "plan"
              ? "A API-FOOTBALL recusou player statistics por restrição de plano ou entitlement."
              : "A API-FOOTBALL recusou a consulta de player statistics.",
        );
      }
    }
    await this.cache?.set({
      provider: "API-FOOTBALL",
      dataFamily: "player_match_stats",
      cacheKey: key,
      payload: read.payload,
      ttlMs: PLAYER_STATS_TTL_MS,
    });
    return read;
  }

  async getFixtureSnapshots(fixture: ProviderFixture): Promise<{
    snapshots: NormalizedPlayerMatchStats[];
    meta: ProviderReadMeta;
  }> {
    const key = `fixture:${fixture.id}`;
    const wasCached = await this.cache?.get<unknown>("API-FOOTBALL", "player_match_stats", key);
    const read = wasCached
      ? { payload: wasCached.payload, fetchedAt: wasCached.fetchedAt }
      : await this.requestFixturePlayers(fixture.id);
    return {
      snapshots: normalizeApiFootballFixturePlayers({
        payload: read.payload,
        fixture,
        fetchedAt: read.fetchedAt,
      }),
      meta: {
        provider: "API-FOOTBALL",
        endpoint: "/fixtures/players",
        dataFamily: "player_match_stats",
        fetchedAt: read.fetchedAt,
        cacheStatus: wasCached ? "hit" : "miss",
      },
    };
  }
}

export function competitionSeasonContains(
  snapshot: NormalizedPlayerMatchStats,
  season: CompetitionSeason,
): boolean {
  if (snapshot.competitionId && snapshot.competitionId !== season.competitionId) return false;
  if (snapshot.seasonId && snapshot.seasonId !== season.seasonId) return false;
  const day = new Date(snapshot.timestamp * 1000).toISOString().slice(0, 10);
  return day >= season.startDate.slice(0, 10) && day <= season.endDate.slice(0, 10);
}
