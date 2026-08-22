import { normalizeFootballEntityName } from "./entity-resolver.ts";

export type FootballEntityType = "team" | "player";

export interface VerifiedEntityAlias {
  sport: "football";
  entityType: FootballEntityType;
  provider: string;
  alias: string;
  providerEntityId: number;
  canonicalName: string;
  confidence: number;
  source: "verified_seed";
}

const VERIFIED_ALIASES: readonly VerifiedEntityAlias[] = [
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Bayern de Munique",
    providerEntityId: 79,
    canonicalName: "FC Bayern München",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Bayern Munich",
    providerEntityId: 79,
    canonicalName: "FC Bayern München",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Bayern München",
    providerEntityId: 79,
    canonicalName: "FC Bayern München",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "FC Bayern München",
    providerEntityId: 79,
    canonicalName: "FC Bayern München",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "PSG",
    providerEntityId: 114,
    canonicalName: "Paris Saint-Germain",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Paris SG",
    providerEntityId: 114,
    canonicalName: "Paris Saint-Germain",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Inter de Milão",
    providerEntityId: 77,
    canonicalName: "Inter",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Inter Milan",
    providerEntityId: 77,
    canonicalName: "Inter",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Atlético de Madrid",
    providerEntityId: 54,
    canonicalName: "Atlético Madrid",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Atletico Madrid",
    providerEntityId: 54,
    canonicalName: "Atlético Madrid",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "team",
    provider: "BSD",
    alias: "Borussia de Dortmund",
    providerEntityId: 92,
    canonicalName: "Borussia Dortmund",
    confidence: 1,
    source: "verified_seed",
  },
  {
    sport: "football",
    entityType: "player",
    provider: "BSD",
    alias: "Yuri Alberto",
    providerEntityId: 1146,
    canonicalName: "Yuri Alberto",
    confidence: 1,
    source: "verified_seed",
  },
];

export function getVerifiedEntityAlias(
  provider: string,
  entityType: FootballEntityType,
  alias: string,
): VerifiedEntityAlias | null {
  const normalized = normalizeFootballEntityName(alias);
  return (
    VERIFIED_ALIASES.find(
      (candidate) =>
        candidate.provider === provider &&
        candidate.entityType === entityType &&
        normalizeFootballEntityName(candidate.alias) === normalized,
    ) ?? null
  );
}

export function listVerifiedEntityAliases(): readonly VerifiedEntityAlias[] {
  return VERIFIED_ALIASES;
}
