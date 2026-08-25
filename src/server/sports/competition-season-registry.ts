import type { SemanticQuery } from "../analysis/semantic-plan";

export type CompetitionProvider = "BSD" | "API-FOOTBALL";

export interface CompetitionProviderRef {
  provider: CompetitionProvider;
  competitionId: string;
}

export interface CompetitionDefinition {
  canonicalName: string;
  aliases: readonly string[];
  countryHint: string | null;
  providerRefs: readonly CompetitionProviderRef[];
}

export interface CompetitionSeason {
  provider: CompetitionProvider;
  competitionId: string;
  seasonId: string;
  label: string;
  startDate: string;
  endDate: string;
  current: boolean;
  country: string | null;
  coverage: Readonly<Record<string, boolean | null>>;
  competition: string;
}

export interface CompetitionSeasonResolver {
  resolveCompetition(name: string): Promise<CompetitionDefinition | null>;
  resolveSeason(
    competition: CompetitionDefinition,
    season: string,
  ): Promise<CompetitionSeason | null>;
}

const DEFINITIONS: CompetitionDefinition[] = [
  {
    canonicalName: "Brasileirão Série A",
    aliases: [
      "brasileirao",
      "brasileirao serie a",
      "campeonato brasileiro",
      "campeonato brasileiro serie a",
      "brasileiro",
      "brazilian serie a",
    ],
    countryHint: "Brazil",
    providerRefs: [],
  },
  {
    canonicalName: "Premier League",
    aliases: ["premier", "premier league"],
    countryHint: "England",
    providerRefs: [],
  },
  {
    canonicalName: "La Liga",
    aliases: ["la liga", "laliga", "primera division"],
    countryHint: "Spain",
    providerRefs: [],
  },
  {
    canonicalName: "Bundesliga",
    aliases: ["bundesliga", "bundesliga alema"],
    countryHint: "Germany",
    providerRefs: [],
  },
  {
    canonicalName: "UEFA Champions League",
    aliases: ["champions", "champions league", "uefa champions league", "ucl"],
    countryHint: null,
    providerRefs: [],
  },
  {
    canonicalName: "Copa do Brasil",
    aliases: ["copa do brasil"],
    countryHint: "Brazil",
    providerRefs: [],
  },
  {
    canonicalName: "Copa Libertadores",
    aliases: ["libertadores", "copa libertadores", "conmebol libertadores"],
    countryHint: null,
    providerRefs: [],
  },
];

export function normalizeCompetitionText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCompetitionDefinition(value: string): CompetitionDefinition | null {
  const normalized = normalizeCompetitionText(value);
  return (
    DEFINITIONS.find(
      (definition) =>
        normalizeCompetitionText(definition.canonicalName) === normalized ||
        definition.aliases.some((alias) => normalizeCompetitionText(alias) === normalized),
    ) ?? null
  );
}

export function canonicalizeCompetitionName(value: string): string {
  return getCompetitionDefinition(value)?.canonicalName ?? value.trim();
}

export function competitionAliases(value: string): readonly string[] {
  const definition = getCompetitionDefinition(value);
  return definition
    ? Array.from(new Set([definition.canonicalName, ...definition.aliases]))
    : [value.trim()];
}

function normalizeSeason(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "").replace("-", "/");
}

function seasonDateLabel(season: CompetitionSeason): string[] {
  const startYear = season.startDate.slice(0, 4);
  const endYear = season.endDate.slice(0, 4);
  const labels = new Set<string>([season.label, season.seasonId]);
  if (/^\d{4}$/.test(startYear) && /^\d{4}$/.test(endYear)) {
    if (startYear === endYear) labels.add(startYear);
    else {
      labels.add(`${startYear}/${endYear}`);
      labels.add(`${startYear}/${endYear.slice(2)}`);
    }
  }
  return [...labels];
}

/**
 * Resolve only from provider-returned seasons. Dates are used for matching labels, never inferred
 * from the requested text. In particular, "current" requires provider current=true and
 * "previous" is defined only relative to that real current season.
 */
export function selectProviderSeason(
  seasons: readonly CompetitionSeason[],
  requested: string,
): CompetitionSeason | null {
  const selector = normalizeSeason(requested);
  if (selector === "current" || selector === "atual") {
    const current = seasons.filter((season) => season.current);
    return current.length === 1 ? current[0] : null;
  }

  if (selector === "previous" || selector === "anterior") {
    const current = seasons.filter((season) => season.current);
    if (current.length !== 1) return null;
    const ordered = [...seasons].sort((left, right) => {
      const byStart = left.startDate.localeCompare(right.startDate);
      return byStart || left.seasonId.localeCompare(right.seasonId);
    });
    const index = ordered.findIndex(
      (season) =>
        season.seasonId === current[0].seasonId &&
        season.competitionId === current[0].competitionId,
    );
    return index > 0 ? ordered[index - 1] : null;
  }

  const matches = seasons.filter((season) =>
    seasonDateLabel(season).some((label) => normalizeSeason(label) === selector),
  );
  return matches.length === 1 ? matches[0] : null;
}

export type SeasonTruthStatus =
  | { executable: true; status: "not_requested" | "runtime_provider_resolution"; reason: null }
  | { executable: false; status: "provider_resolution_required"; reason: string };

export function seasonTruthStatus(query: SemanticQuery): SeasonTruthStatus {
  if (!query.scope.season) return { executable: true, status: "not_requested", reason: null };
  if (!query.scope.competition) {
    return {
      executable: false,
      status: "provider_resolution_required",
      reason: `A temporada "${query.scope.season}" exige uma competição explícita para resolver um CompetitionSeason real sem ambiguidade.`,
    };
  }
  if (
    query.entity.type === "team" &&
    ["aggregate", "match_list", "head_to_head"].includes(query.query_kind)
  ) {
    return { executable: true, status: "runtime_provider_resolution", reason: null };
  }
  return {
    executable: false,
    status: "provider_resolution_required",
    reason: `A temporada "${query.scope.season}" foi preservada, mas esse executor ainda não possui resolução provider-backed de CompetitionSeason. Nenhuma janela de calendário será inferida.`,
  };
}

export const competitionRegistry = DEFINITIONS;
