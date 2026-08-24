import type { SportsCacheObserver } from "./cache/cache-observer";
import { normalizeFootballEntityName } from "./entity-resolver.ts";
import type {
  CachedPlayerIdentity,
  Phase3dSportsRepository,
  PersistedEntityAlias,
} from "./phase3d-repository.server";
import {
  playerMetricValue,
  playerParticipated,
  type PlayerFixtureStat,
  type PlayerGoalEvent,
  type PlayerMetric,
  type PlayerSportsDataProvider,
  type ResolvedPlayer,
} from "./player-provider.ts";
import { getVerifiedEntityAlias } from "./verified-aliases.ts";

const PLAYER_IDENTITY_TTL_MS = 24 * 60 * 60 * 1000;
const PLAYER_STATS_FEED_TTL_MS = 10 * 60 * 1000;
const PLAYER_EVENTS_FEED_TTL_MS = 60 * 60 * 1000;
const EMPTY_SHOTMAP_TTL_MS = 10 * 60 * 1000;
const PLAYER_STATS_HISTORY_LIMIT = 80;

function isFresh(value: string | null | undefined, ttlMs: number, now = Date.now()): boolean {
  if (!value) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && now - timestamp >= 0 && now - timestamp <= ttlMs;
}

function competitionKey(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function competitionAllowed(value: string, names?: readonly string[] | null): boolean {
  if (!names || names.length === 0) return true;
  const target = competitionKey(value);
  return names.some((name) => competitionKey(name) === target);
}

async function bestEffort<T>(operation: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    console.warn("[player-cache] cache operation failed; using provider path", {
      operation,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
    return fallback;
  }
}

function toPersistedAlias(
  provider: string,
  input: string,
  player: ResolvedPlayer,
): PersistedEntityAlias {
  return {
    provider,
    entityType: "player",
    alias: input,
    normalizedAlias: normalizeFootballEntityName(input),
    providerEntityId: player.id,
    canonicalName: player.name,
    confidence: 1,
    source: "provider_resolution",
  };
}

export class PlayerDataService {
  constructor(
    private readonly provider: PlayerSportsDataProvider,
    private readonly repository: Phase3dSportsRepository | null,
    private readonly observer?: SportsCacheObserver,
  ) {}

  private async readIdentity(playerId: number): Promise<CachedPlayerIdentity | null> {
    if (!this.repository) return null;
    return bestEffort("player identity read", null, () =>
      this.repository!.getPlayerById(this.provider.name, playerId),
    );
  }

  async resolvePlayer(input: string): Promise<ResolvedPlayer> {
    let alias: PersistedEntityAlias | null = null;
    if (this.repository) {
      alias = await bestEffort("player alias read", null, () =>
        this.repository!.getAlias(this.provider.name, "player", input),
      );
    }
    if (!alias) {
      const verified = getVerifiedEntityAlias(this.provider.name, "player", input);
      if (verified) {
        alias = {
          provider: verified.provider,
          entityType: verified.entityType,
          alias: verified.alias,
          normalizedAlias: normalizeFootballEntityName(verified.alias),
          providerEntityId: verified.providerEntityId,
          canonicalName: verified.canonicalName,
          confidence: verified.confidence,
          source: verified.source,
        };
      }
    }

    if (alias) {
      const cached = await this.readIdentity(alias.providerEntityId);
      if (cached && isFresh(cached.fetchedAt, PLAYER_IDENTITY_TTL_MS)) {
        this.observer?.cacheHit(this.provider.name, "player_identity");
        return cached;
      }
      this.observer?.cacheMiss(this.provider.name, "player_identity");
      this.observer?.providerCall(this.provider.name, "getPlayerById");
      const player = await this.provider.getPlayerById(alias.providerEntityId);
      if (player.id !== alias.providerEntityId) {
        throw new Error("Provider returned a different player id for a persisted alias");
      }
      if (this.repository) {
        await bestEffort("player identity write", undefined, () =>
          this.repository!.upsertPlayer(this.provider.name, player),
        );
      }
      return player;
    }

    const normalized = normalizeFootballEntityName(input);
    if (this.repository) {
      const cachedByName = await bestEffort("player canonical lookup", null, () =>
        this.repository!.getPlayerByNormalizedName(this.provider.name, normalized),
      );
      if (cachedByName && isFresh(cachedByName.fetchedAt, PLAYER_IDENTITY_TTL_MS)) {
        this.observer?.cacheHit(this.provider.name, "player_identity");
        return cachedByName;
      }
    }

    this.observer?.cacheMiss(this.provider.name, "player_identity");
    this.observer?.providerCall(this.provider.name, "resolvePlayer");
    const player = await this.provider.resolvePlayer(input);
    if (this.repository) {
      await bestEffort("player identity write", undefined, () =>
        this.repository!.upsertPlayer(this.provider.name, player),
      );
      await bestEffort("player alias write", undefined, () =>
        this.repository!.upsertAlias(toPersistedAlias(this.provider.name, input, player)),
      );
    }
    return player;
  }

  async getRecentParticipatedStats(
    player: ResolvedPlayer,
    count: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerFixtureStat[]> {
    const cachedState = await this.readIdentity(player.id);
    let rows: PlayerFixtureStat[] = [];

    if (
      this.repository &&
      cachedState &&
      isFresh(cachedState.statsFetchedAt, PLAYER_STATS_FEED_TTL_MS) &&
      cachedState.statsRequestedCount >= PLAYER_STATS_HISTORY_LIMIT
    ) {
      rows = await bestEffort("player stats read", [], () =>
        this.repository!.listRecentPlayerStats(
          this.provider.name,
          player.id,
          PLAYER_STATS_HISTORY_LIMIT,
        ),
      );
      const expected = Math.min(cachedState.statsReturnedCount, PLAYER_STATS_HISTORY_LIMIT);
      if (rows.length >= expected) {
        this.observer?.cacheHit(this.provider.name, "player_fixture_stats");
      } else {
        rows = [];
      }
    }

    if (rows.length === 0) {
      this.observer?.cacheMiss(this.provider.name, "player_fixture_stats");
      this.observer?.providerCall(this.provider.name, "getRecentPlayerStats");
      rows = await this.provider.getRecentPlayerStats(player, PLAYER_STATS_HISTORY_LIMIT, null);
      if (this.repository) {
        await bestEffort("player stats write", undefined, () =>
          this.repository!.upsertPlayerStats(this.provider.name, player.id, rows),
        );
        await bestEffort("player stats marker", undefined, () =>
          this.repository!.markPlayerStatsFetched(
            this.provider.name,
            player.id,
            PLAYER_STATS_HISTORY_LIMIT,
            rows.length,
          ),
        );
      }
    }

    return rows
      .filter(playerParticipated)
      .filter((stat) => competitionAllowed(stat.competition, competitionNames))
      .sort((a, b) => a.timestamp - b.timestamp)
      .slice(-count);
  }

  async ensureMetric(
    player: ResolvedPlayer,
    stats: readonly PlayerFixtureStat[],
    metric: PlayerMetric,
  ): Promise<PlayerFixtureStat[]> {
    if (metric !== "shots" && metric !== "shots_on_target") return [...stats];

    return Promise.all(
      stats.map(async (stat) => {
        if (playerMetricValue(stat, metric) !== null) return stat;
        if (stat.shotmapCheckedAt && isFresh(stat.shotmapCheckedAt, EMPTY_SHOTMAP_TTL_MS)) {
          return stat;
        }

        this.observer?.cacheMiss(this.provider.name, "player_shotmap");
        this.observer?.providerCall(this.provider.name, "getFixtureShotStats");
        const shot = await this.provider.getFixtureShotStats(stat.fixtureId, player.id);
        const checkedAt = new Date().toISOString();
        const updated: PlayerFixtureStat = {
          ...stat,
          shots: shot.coverage ? shot.shots : stat.shots,
          shotsOnTarget: shot.coverage ? shot.shotsOnTarget : stat.shotsOnTarget,
          shotmapCovered: shot.coverage,
          shotmapCheckedAt: checkedAt,
        };
        if (this.repository) {
          await bestEffort("player shotmap write", undefined, () =>
            this.repository!.upsertPlayerStats(this.provider.name, player.id, [updated]),
          );
        }
        return updated;
      }),
    );
  }

  async getRecentGoalEvents(
    player: ResolvedPlayer,
    eventCount: number,
    competitionNames?: readonly string[] | null,
  ): Promise<PlayerGoalEvent[]> {
    const state = await this.readIdentity(player.id);
    if (this.repository && state && isFresh(state.eventsFetchedAt, PLAYER_EVENTS_FEED_TTL_MS)) {
      const cached = await bestEffort("player events read", [], () =>
        this.repository!.listPlayerGoalEvents(this.provider.name, player.id, eventCount),
      );
      if (cached.length >= eventCount) {
        this.observer?.cacheHit(this.provider.name, "player_events");
        return cached.slice(0, eventCount);
      }
      console.info("[player-cache] cached event list is incomplete for requested count", {
        provider: this.provider.name,
        playerId: player.id,
        cached: cached.length,
        requested: eventCount,
      });
    }

    this.observer?.cacheMiss(this.provider.name, "player_events");
    const stats = await this.getRecentParticipatedStats(
      player,
      PLAYER_STATS_HISTORY_LIMIT,
      competitionNames,
    );
    const events: PlayerGoalEvent[] = [];
    const candidates = [...stats]
      .sort((a, b) => b.timestamp - a.timestamp)
      .filter((stat) => stat.goals === null || stat.goals > 0);

    for (const stat of candidates) {
      if (events.length >= eventCount) break;
      this.observer?.providerCall(this.provider.name, "getGoalEventsForFixture");
      const fixtureEvents = await this.provider.getGoalEventsForFixture(stat, player.id);
      if (fixtureEvents.coverage) events.push(...fixtureEvents.events);
    }

    events.sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      const bMinute = (b.minute ?? -1) * 100 + (b.extraTime ?? 0);
      const aMinute = (a.minute ?? -1) * 100 + (a.extraTime ?? 0);
      return bMinute - aMinute;
    });

    if (this.repository) {
      await bestEffort("player events write", undefined, () =>
        this.repository!.upsertPlayerEvents(this.provider.name, player.id, events),
      );
      await bestEffort("player events marker", undefined, () =>
        this.repository!.markPlayerEventsFetched(this.provider.name, player.id),
      );
    }
    return events.slice(0, eventCount);
  }
}
