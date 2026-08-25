import { canonicalizeCompetitionName } from "../sports/competition-season-registry";
import {
  getFootballMetricDefinition,
  PLAYER_METRIC_KEYS,
  type PlayerMetricKey,
} from "../sports/metric-catalog";
import { semanticQuerySchema, type SemanticFilter, type SemanticQuery } from "./semantic-plan";

type NumericOperator = "eq" | "gt" | "gte" | "lt" | "lte";

type ParsedTail = {
  scope: Record<string, unknown>;
  filters: SemanticFilter[];
  groupBy: string[];
};

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[?!.]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const PLAYER_METRIC_ALIASES = new Map<string, PlayerMetricKey>();
for (const metric of PLAYER_METRIC_KEYS) {
  const definition = getFootballMetricDefinition(metric, "player");
  if (!definition) continue;
  PLAYER_METRIC_ALIASES.set(normalizedText(metric.replace(/_/g, " ")), metric);
  PLAYER_METRIC_ALIASES.set(normalizedText(definition.label), metric);
  for (const alias of definition.aliases) {
    PLAYER_METRIC_ALIASES.set(normalizedText(alias), metric);
  }
}

function metricFromText(value: string): PlayerMetricKey | null {
  const normalized = normalizedText(value)
    .replace(/^(?:os|as|o|a) /, "")
    .replace(/ (?:dele|dela)$/, "")
    .trim();
  return PLAYER_METRIC_ALIASES.get(normalized) ?? null;
}

function positiveInt(value: string): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

function finiteNumber(value: string): number | null {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function operatorFromText(value: string): NumericOperator | null {
  const key = normalizedText(value);
  if (key === "igual a") return "eq";
  if (key === "mais de" || key === "maior que") return "gt";
  if (key === "pelo menos" || key === "no minimo" || key === "maior ou igual a") return "gte";
  if (key === "menos de" || key === "menor que") return "lt";
  if (key === "no maximo" || key === "menor ou igual a") return "lte";
  return null;
}

function cleanEntityName(value: string): string {
  const lowerWords = new Set(["da", "das", "de", "do", "dos", "e"]);
  return value
    .trim()
    .split(/\s+/)
    .map((word, index) => {
      if (index > 0 && lowerWords.has(word)) return word;
      return word ? `${word[0].toUpperCase()}${word.slice(1)}` : word;
    })
    .join(" ");
}

function baseScope(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { venue: "all", half: "full", status: "finished", ...extra };
}

function parseQuery(candidate: unknown): SemanticQuery | null {
  const parsed = semanticQuerySchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

function parseSingleFilter(value: string): SemanticFilter | null {
  const text = normalizedText(value).replace(/^(?:ele|ela) /, "");

  let match = text.match(
    /^(?:teve )?(pelo menos|no minimo|mais de|menos de|no maximo) (\d+(?:[.,]\d+)?) (.+)$/,
  );
  if (match) {
    const operator = operatorFromText(match[1]);
    const number = finiteNumber(match[2]);
    const metric = metricFromText(match[3]);
    if (!operator || number === null || !metric) return null;
    return { field: metric, operator, value: number };
  }

  match = text.match(
    /^(?:teve )?(.+?) (maior ou igual a|menor ou igual a|maior que|menor que|igual a) (\d+(?:[.,]\d+)?)$/,
  );
  if (match) {
    const metric = metricFromText(match[1]);
    const operator = operatorFromText(match[2]);
    const number = finiteNumber(match[3]);
    if (!metric || !operator || number === null) return null;
    return { field: metric, operator, value: number };
  }

  match = text.match(
    /^finalizou (pelo menos|no minimo|mais de|menos de|no maximo) (\d+(?:[.,]\d+)?) vezes?$/,
  );
  if (match) {
    const metric = metricFromText("finalizacoes");
    const operator = operatorFromText(match[1]);
    const number = finiteNumber(match[2]);
    if (!metric || !operator || number === null) return null;
    return { field: metric, operator, value: number };
  }

  return null;
}

function parseFilters(value: string): SemanticFilter[] | null {
  const parts = normalizedText(value)
    .split(" e ")
    .map((item) => item.trim())
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 12) return null;

  const filters = parts.map(parseSingleFilter);
  return filters.every((item): item is SemanticFilter => item !== null) ? filters : null;
}

const TAIL_MARKERS = [
  " em casa e fora",
  " fora de casa",
  " em casa",
  " nos ultimos ",
  " nos jogos em que ",
  " por competicao",
  " contra ",
  " na ",
  " no segundo tempo",
  " no primeiro tempo",
] as const;

function splitPlayerAndTail(value: string): { player: string; tail: string } | null {
  let firstMarker = value.length;
  for (const marker of TAIL_MARKERS) {
    const index = value.indexOf(marker);
    if (index >= 0 && index < firstMarker) firstMarker = index;
  }

  const player = value.slice(0, firstMarker).trim();
  const tail = value.slice(firstMarker).trim();
  if (!player) return null;
  return { player: cleanEntityName(player), tail };
}

function parseAggregateTail(value: string): ParsedTail | null {
  let rest = normalizedText(value);
  const scope = baseScope();
  const filters: SemanticFilter[] = [];
  const groupBy: string[] = [];

  while (rest) {
    let match = rest.match(/^nos ultimos (\d+) jogos(?: |$)/);
    if (match) {
      const lastMatches = positiveInt(match[1]);
      if (!lastMatches || scope.last_matches !== undefined) return null;
      scope.last_matches = lastMatches;
      rest = rest.slice(match[0].length).trim();
      continue;
    }

    if (rest === "fora de casa" || rest.startsWith("fora de casa ")) {
      if (scope.venue !== "all") return null;
      scope.venue = "away";
      rest = rest.slice("fora de casa".length).trim();
      continue;
    }

    if (rest === "em casa e fora" || rest.startsWith("em casa e fora ")) {
      if (groupBy.includes("venue")) return null;
      groupBy.push("venue");
      rest = rest.slice("em casa e fora".length).trim();
      continue;
    }

    if (rest === "em casa" || rest.startsWith("em casa ")) {
      if (scope.venue !== "all") return null;
      scope.venue = "home";
      rest = rest.slice("em casa".length).trim();
      continue;
    }

    if (rest === "por competicao" || rest.startsWith("por competicao ")) {
      if (groupBy.includes("competition")) return null;
      groupBy.push("competition");
      rest = rest.slice("por competicao".length).trim();
      continue;
    }

    match = rest.match(/^na (.+?) (\d{4}(?:\/\d{2})?)$/);
    if (match) {
      if (scope.competition !== undefined || scope.season !== undefined) return null;
      scope.competition = canonicalizeCompetitionName(cleanEntityName(match[1]));
      scope.season = match[2];
      rest = "";
      continue;
    }

    match = rest.match(/^contra (?:o |a )?(.+)$/);
    if (match) {
      if (scope.opponent !== undefined) return null;
      scope.opponent = cleanEntityName(match[1]);
      rest = "";
      continue;
    }

    match = rest.match(/^nos jogos em que (.+)$/);
    if (match) {
      const parsedFilters = parseFilters(match[1]);
      if (!parsedFilters || filters.length > 0) return null;
      filters.push(...parsedFilters);
      rest = "";
      continue;
    }

    return null;
  }

  return { scope, filters, groupBy };
}

function buildAggregate(
  metricText: string,
  playerAndTail: string,
  aggregation: "average" | "total",
  requireGroup: boolean = false,
): SemanticQuery | null {
  const metric = metricFromText(metricText);
  const split = splitPlayerAndTail(playerAndTail);
  if (!metric || !split) return null;

  const parsedTail = parseAggregateTail(split.tail);
  if (!parsedTail || (requireGroup && parsedTail.groupBy.length === 0)) return null;

  return parseQuery({
    sport: "football",
    entity: { type: "player", name: split.player },
    query_kind: "aggregate",
    metric,
    aggregation,
    scope: parsedTail.scope,
    filters: parsedTail.filters,
    group_by: parsedTail.groupBy,
  });
}

function parseMatchList(text: string): SemanticQuery | null {
  let match = text.match(
    /^(?:liste|mostre) os ultimos (\d+) jogos (?:do|da) (.+?) (?:mostrando|com) (.+)$/,
  );
  if (match) {
    const lastMatches = positiveInt(match[1]);
    const metric = metricFromText(match[3]);
    if (!lastMatches || !metric) return null;
    return parseQuery({
      sport: "football",
      entity: { type: "player", name: cleanEntityName(match[2]) },
      query_kind: "match_list",
      metric,
      scope: baseScope({ last_matches: lastMatches }),
      filters: [],
      group_by: [],
    });
  }

  match = text.match(/^(?:liste|mostre) os jogos (?:do|da) (.+?) em que (.+)$/);
  if (!match) return null;

  let condition = match[2];
  let displayMetricText: string | null = null;
  const showingIndex = condition.lastIndexOf(" mostrando ");
  if (showingIndex >= 0) {
    displayMetricText = condition.slice(showingIndex + " mostrando ".length).trim();
    condition = condition.slice(0, showingIndex).trim();
  }

  const filters = parseFilters(condition);
  if (!filters) return null;
  const metric = displayMetricText
    ? metricFromText(displayMetricText)
    : metricFromText(filters[0].field);
  if (!metric) return null;

  return parseQuery({
    sport: "football",
    entity: { type: "player", name: cleanEntityName(match[1]) },
    query_kind: "match_list",
    metric,
    scope: baseScope(),
    filters,
    group_by: [],
  });
}

/**
 * Narrow deterministic grammar for unambiguous Phase 5C player-stat questions.
 *
 * This intentionally recognizes only complete supported constructions. Any unconsumed qualifier,
 * unsupported player metric, ambiguous population query, event timeline request, or other extra
 * condition returns null so the full semantic path can handle it fail-closed without silent loss.
 */
export function parseDeterministicPhase5cPlayerQuestion(question: string): SemanticQuery | null {
  const text = normalizedText(question);

  const matchList = parseMatchList(text);
  if (matchList) return matchList;

  let match = text.match(/^compare a media de (.+?) (?:do|da) (.+)$/);
  if (match) return buildAggregate(match[1], match[2], "average", true);

  match = text.match(/^(?:(?:qual (?:foi )?a )?media de )(.+?) (?:do|da) (.+)$/);
  if (match) return buildAggregate(match[1], match[2], "average");

  match = text.match(/^(?:qual (?:foi )?a )(.+?) media (?:do|da) (.+)$/);
  if (match) return buildAggregate(match[1], match[2], "average");

  match = text.match(/^total de (.+?) (?:do|da) (.+)$/);
  if (match) return buildAggregate(match[1], match[2], "total");

  match = text.match(/^quant(?:os|as) (.+?) (?:o|a) (.+?) (marcou|teve|fez)(?: (.+))?$/);
  if (match) {
    const metric = metricFromText(match[1]);
    if (!metric) return null;
    if ((match[3] === "marcou" || match[3] === "fez") && metric !== "goals") return null;
    return buildAggregate(match[1], `${match[2]}${match[4] ? ` ${match[4]}` : ""}`, "total");
  }

  return null;
}
