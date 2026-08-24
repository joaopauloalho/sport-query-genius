import type { SportsCacheObserver } from "./cache/cache-observer";
import type { SportsCacheRepository } from "./cache/repository";
import type { Phase3dSportsRepository, PersistedEntityAlias } from "./phase3d-repository.server";
import type {
  ProviderFixture,
  ResolvedTeam,
  SportsDataProvider,
  TeamFixtureFilters,
} from "./provider";
import type { MatchRecord } from "@/data/sports";
import type { QueryIntentInput } from "@/server/analysis/intent-schema";
import { getVerifiedEntityAlias } from "./verified-aliases";

async function bestEffort(operation: string, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.warn("[entity-alias] cache write failed; provider result kept", {
      operation,
      error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
    });
  }
}

export class AliasAwareTeamProvider implements SportsDataProvider {
  constructor(
    private readonly delegate: SportsDataProvider,
    private readonly aliases: Phase3dSportsRepository | null,
    private readonly teamCache: SportsCacheRepository | null,
    private readonly observer?: SportsCacheObserver,
  ) {}

  get name(): string {
    return this.delegate.name;
  }

  private async lookupAlias(name: string): Promise<PersistedEntityAlias | null> {
    if (this.aliases) {
      try {
        const persisted = await this.aliases.getAlias(this.name, "team", name);
        if (persisted) return persisted;
      } catch (error) {
        console.warn("[entity-alias] alias read failed; continuing with deterministic resolver", {
          provider: this.name,
          error: error instanceof Error ? error.message.slice(0, 300) : "unknown",
        });
      }
    }

    const verified = getVerifiedEntityAlias(this.name, "team", name);
    if (!verified) return null;
    return {
      provider: verified.provider,
      entityType: verified.entityType,
      alias: verified.alias,
      normalizedAlias: "",
      providerEntityId: verified.providerEntityId,
      canonicalName: verified.canonicalName,
      confidence: verified.confidence,
      source: verified.source,
    };
  }

  async resolveTeam(name: string): Promise<ResolvedTeam> {
    const alias = await this.lookupAlias(name);
    if (alias) {
      this.observer?.cacheHit(this.name, "team_alias");
      const team: ResolvedTeam = {
        id: alias.providerEntityId,
        name: alias.canonicalName,
        country: "",
      };
      if (this.teamCache) {
        await bestEffort("team identity from alias", () =>
          this.teamCache!.upsertTeam(this.name, team),
        );
      }
      console.info("[entity-alias] team alias resolved", {
        provider: this.name,
        query: name,
        teamId: team.id,
        canonicalName: team.name,
        source: alias.source,
      });
      return team;
    }

    this.observer?.cacheMiss(this.name, "team_alias");
    const team = await this.delegate.resolveTeam(name);
    if (this.aliases) {
      await bestEffort("team alias persistence", () =>
        this.aliases!.upsertAlias({
          provider: this.name,
          entityType: "team",
          alias: name,
          normalizedAlias: "",
          providerEntityId: team.id,
          canonicalName: team.name,
          confidence: 1,
          source: "provider_resolution",
        }),
      );
    }
    return team;
  }

  getRecentTeamFixtures(
    teamId: number,
    count: number,
    filters?: TeamFixtureFilters,
  ): Promise<ProviderFixture[]> {
    return this.delegate.getRecentTeamFixtures(teamId, count, filters);
  }

  getFixtureMetric(
    fixture: ProviderFixture,
    teamId: number,
    metric: QueryIntentInput["metric"],
  ): Promise<MatchRecord | null> {
    return this.delegate.getFixtureMetric(fixture, teamId, metric);
  }
}
