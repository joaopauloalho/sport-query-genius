import { canonicalizeCompetitionName } from "../sports/competition-season-registry";
import {
  getFootballMetricDefinition,
  TEAM_METRIC_KEYS,
  type TeamMetric,
} from "../sports/metric-catalog";
import { semanticQuerySchema, type SemanticQuery } from "./semantic-plan";

type Operator = "gt" | "gte" | "lt" | "lte";

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const METRIC_ALIASES = new Map<string, TeamMetric>();
for (const metric of TEAM_METRIC_KEYS) {
  const definition = getFootballMetricDefinition(metric, "team");
  if (!definition) continue;
  METRIC_ALIASES.set(normalizedText(metric.replace(/_/g, " ")), metric);
  METRIC_ALIASES.set(normalizedText(definition.label), metric);
  for (const alias of definition.aliases) METRIC_ALIASES.set(normalizedText(alias), metric);
}
// Common wording that is semantically identical to the provider-backed catalog aliases.
METRIC_ALIASES.set("chutes no alvo", "shots_on_target");
METRIC_ALIASES.set("finalizacoes no alvo", "shots_on_target");

function metricFromText(value: string): TeamMetric | null {
  return METRIC_ALIASES.get(normalizedText(value)) ?? null;
}

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

function finiteNumber(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function operatorFromText(value: string): Operator | null {
  const key = normalizedText(value);
  if (key === "mais de") return "gt";
  if (key === "pelo menos" || key === "no minimo") return "gte";
  if (key === "menos de") return "lt";
  if (key === "no maximo") return "lte";
  return null;
}

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function baseScope(extra: Record<string, unknown> = {}) {
  return { venue: "all" as const, half: "full" as const, ...extra };
}

function parseQuery(candidate: unknown): SemanticQuery | null {
  const parsed = semanticQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Narrow, deterministic Phase 5B grammar for unambiguous team-stat questions.
 *
 * This is intentionally not a general NLP fallback. It returns null unless the complete normalized
 * question matches one of the supported grammars, so extra constraints can never be dropped merely
 * to make an LLM response executable.
 */
export function parseDeterministicPhase5bTeamQuestion(question: string): SemanticQuery | null {
  const text = normalizedText(question);

  let match = text.match(/^qual a media de (.+?) (?:do|da|dos|das) (.+?) nos ultimos (\d+) jogos$/);
  if (match) {
    const metric = metricFromText(match[1]);
    const lastMatches = positiveInt(match[3]);
    if (!metric || !lastMatches) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[2]) },
      query_kind: "aggregate",
      metric,
      aggregation: "average",
      scope: baseScope({ last_matches: lastMatches }),
      filters: [],
      group_by: [],
    });
  }

  match = text.match(
    /^qual a media de (.+?) (?:do|da|dos|das) (.+?) nos jogos em que (?:teve|tiveram) (mais de|pelo menos|no minimo|menos de|no maximo) (\d+(?:[.,]\d+)?) (.+)$/,
  );
  if (match) {
    const metric = metricFromText(match[1]);
    const filterMetric = metricFromText(match[5]);
    const operator = operatorFromText(match[3]);
    const value = finiteNumber(match[4]);
    if (!metric || !filterMetric || !operator || value === null) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[2]) },
      query_kind: "aggregate",
      metric,
      aggregation: "average",
      scope: baseScope(),
      filters: [{ field: filterMetric, operator, value }],
      group_by: [],
    });
  }

  match = text.match(/^quantos? (.+?) (?:o|a|os|as) (.+?) teve nos jogos em que venceu$/);
  if (match) {
    const metric = metricFromText(match[1]);
    if (!metric) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[2]) },
      query_kind: "aggregate",
      metric,
      aggregation: "total",
      scope: baseScope(),
      filters: [{ field: "outcome", operator: "eq", value: "win" }],
      group_by: [],
    });
  }

  match = text.match(
    /^qual a media de (.+?) (?:do|da|dos|das) (.+?) na (.+?) (\d{4}(?:\/\d{2})?)$/,
  );
  if (match) {
    const metric = metricFromText(match[1]);
    if (!metric) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[2]) },
      query_kind: "aggregate",
      metric,
      aggregation: "average",
      scope: baseScope({
        competition: canonicalizeCompetitionName(cleanName(match[3])),
        season: match[4],
      }),
      filters: [],
      group_by: [],
    });
  }

  match = text.match(
    /^(?:liste|mostre) os jogos (?:do|da|dos|das) (.+?) na (.+?) (\d{4}(?:\/\d{2})?) com (mais de|pelo menos|no minimo|menos de|no maximo) (\d+(?:[.,]\d+)?) (.+)$/,
  );
  if (match) {
    const metric = metricFromText(match[6]);
    const operator = operatorFromText(match[4]);
    const value = finiteNumber(match[5]);
    if (!metric || !operator || value === null) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[1]) },
      query_kind: "match_list",
      metric,
      scope: baseScope({
        competition: canonicalizeCompetitionName(cleanName(match[2])),
        season: match[3],
      }),
      filters: [{ field: metric, operator, value }],
      group_by: [],
    });
  }

  match = text.match(
    /^(?:liste|mostre) os jogos (?:do|da|dos|das) (.+?) com (mais de|pelo menos|no minimo|menos de|no maximo) (\d+(?:[.,]\d+)?) (.+)$/,
  );
  if (match) {
    const metric = metricFromText(match[4]);
    const operator = operatorFromText(match[2]);
    const value = finiteNumber(match[3]);
    if (!metric || !operator || value === null) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "team", name: cleanName(match[1]) },
      query_kind: "match_list",
      metric,
      scope: baseScope(),
      filters: [{ field: metric, operator, value }],
      group_by: [],
    });
  }

  return null;
}
