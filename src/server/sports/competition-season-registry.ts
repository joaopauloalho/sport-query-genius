import type { SemanticQuery } from "../analysis/semantic-plan";

export type CompetitionProvider = "BSD" | "API_FOOTBALL";

export interface CompetitionProviderRef {
  provider: CompetitionProvider;
  competition_id: string;
}

export interface CompetitionDefinition {
  canonical_name: string;
  aliases: readonly string[];
  provider_refs: readonly CompetitionProviderRef[];
}

export interface CompetitionSeason {
  competition: string;
  provider: CompetitionProvider;
  provider_competition_id: string;
  provider_season_id: string;
  season_label: string;
  start_date: string;
  end_date: string;
  current: boolean;
  country: string | null;
  coverage: Readonly<Record<string, boolean | null>>;
}

export interface CompetitionSeasonResolver {
  resolveCompetition(name: string): Promise<CompetitionDefinition | null>;
  resolveSeason(competition: CompetitionDefinition, season: string): Promise<CompetitionSeason | null>;
}

const DEFINITIONS: CompetitionDefinition[] = [
  {
    canonical_name: "Brasileirão Série A",
    aliases: [
      "brasileirao",
      "brasileirao serie a",
      "campeonato brasileiro",
      "campeonato brasileiro serie a",
      "brasileiro",
      "brazilian serie a",
    ],
    provider_refs: [],
  },
  {
    canonical_name: "Premier League",
    aliases: ["premier", "premier league"],
    // API-Football documents league id 39 for the Premier League.
    provider_refs: [{ provider: "API_FOOTBALL", competition_id: "39" }],
  },
  {
    canonical_name: "La Liga",
    aliases: ["la liga", "laliga", "primera division"],
    provider_refs: [],
  },
  {
    canonical_name: "Bundesliga",
    aliases: ["bundesliga", "bundesliga alema"],
    provider_refs: [],
  },
  {
    canonical_name: "UEFA Champions League",
    aliases: ["champions", "champions league", "uefa champions league", "ucl"],
    provider_refs: [],
  },
  { canonical_name: "Copa do Brasil", aliases: ["copa do brasil"], provider_refs: [] },
  {
    canonical_name: "Copa Libertadores",
    aliases: ["libertadores", "copa libertadores", "conmebol libertadores"],
    provider_refs: [],
  },
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCompetitionDefinition(value: string): CompetitionDefinition | null {
  const normalized = normalize(value);
  return (
    DEFINITIONS.find(
      (definition) =>
        normalize(definition.canonical_name) === normalized ||
        definition.aliases.some((alias) => normalize(alias) === normalized),
    ) ?? null
  );
}

export function canonicalizeCompetitionName(value: string): string {
  return getCompetitionDefinition(value)?.canonical_name ?? value.trim();
}

export function competitionAliases(value: string): readonly string[] {
  const definition = getCompetitionDefinition(value);
  return definition
    ? Array.from(new Set([definition.canonical_name, ...definition.aliases]))
    : [value.trim()];
}

export type SeasonTruthStatus =
  | { executable: true; status: "not_requested"; reason: null }
  | { executable: false; status: "provider_resolution_required"; reason: string };

/**
 * Phase 5A never turns a season label into dates by heuristic. Any scope.season must first be
 * resolved to a real provider CompetitionSeason (competition id, season id, dates and coverage).
 * Explicit date_from/date_to queries remain available when they are requested without a season.
 */
export function seasonTruthStatus(query: SemanticQuery): SeasonTruthStatus {
  if (!query.scope.season) return { executable: true, status: "not_requested", reason: null };
  return {
    executable: false,
    status: "provider_resolution_required",
    reason: `A temporada "${query.scope.season}" foi compreendida, mas ainda exige resolução real de CompetitionSeason no provider (competition id, season id, início, fim e coverage). Nenhuma janela de calendário será inferida; use um intervalo de datas explícito sem season enquanto o resolver provider-backed não estiver conectado.`,
  };
}

export const competitionRegistry = DEFINITIONS;
