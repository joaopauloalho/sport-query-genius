import { normalizeQueryPlanCandidate } from "./query-plan-normalizer";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const token = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9><=\s/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const finiteInt = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value.trim());
  return undefined;
};

const COMPETITIONS = new Map<string, string>([
  ["brasileirao", "Brasileirão Série A"],
  ["brasileirao serie a", "Brasileirão Série A"],
  ["campeonato brasileiro", "Brasileirão Série A"],
  ["campeonato brasileiro serie a", "Brasileirão Série A"],
  ["brasileiro", "Brasileirão Série A"],
  ["brazilian serie a", "Brasileirão Série A"],
  ["premier", "Premier League"],
  ["premier league", "Premier League"],
  ["la liga", "La Liga"],
  ["laliga", "La Liga"],
  ["champions", "UEFA Champions League"],
  ["champions league", "UEFA Champions League"],
  ["uefa champions league", "UEFA Champions League"],
  ["ucl", "UEFA Champions League"],
  ["bundesliga", "Bundesliga"],
  ["copa do brasil", "Copa do Brasil"],
  ["libertadores", "Copa Libertadores"],
  ["copa libertadores", "Copa Libertadores"],
  ["conmebol libertadores", "Copa Libertadores"],
]);

const METRICS = new Map<string, string>([
  ["gols sofridos", "goals_against"],
  ["gols tomados", "goals_against"],
  ["gols levados", "goals_against"],
  ["goals against", "goals_against"],
  ["goals conceded", "goals_against"],
]);

function normalizeCompetition(value: unknown): unknown {
  const key = token(value);
  return key ? (COMPETITIONS.get(key) ?? (typeof value === "string" ? value.trim() : value)) : value;
}

function normalizeSeason(value: unknown): unknown {
  if (typeof value === "number" && Number.isInteger(value) && value >= 1900 && value <= 2200) {
    return String(value);
  }
  const key = token(value);
  if (!key) return value;
  if (["current", "atual", "temporada atual", "nesta temporada"].includes(key)) return "current";
  if (["previous", "last", "passada", "temporada passada", "ultima temporada"].includes(key))
    return "previous";

  const compact = key.replace(/\s/g, "");
  const cross = compact.match(/^(\d{4})[/-](\d{2}|\d{4})$/);
  if (cross) {
    const start = Number(cross[1]);
    const end = cross[2].length === 4 ? Number(cross[2]) % 100 : Number(cross[2]);
    return `${start}/${String(end).padStart(2, "0")}`;
  }
  if (/^\d{4}$/.test(compact)) return compact;
  return typeof value === "string" ? value.trim() : value;
}

const FILTER_FIELDS = new Map<string, string>([
  ["outcome", "outcome"],
  ["resultado", "outcome"],
  ["resultado da partida", "outcome"],
  ["goals for", "goals_for"],
  ["goals_for", "goals_for"],
  ["gols marcados", "goals_for"],
  ["gols feitos", "goals_for"],
  ["goals against", "goals_against"],
  ["goals_against", "goals_against"],
  ["gols sofridos", "goals_against"],
  ["gols tomados", "goals_against"],
  ["gols levados", "goals_against"],
  ["goal difference", "goal_difference"],
  ["goal_difference", "goal_difference"],
  ["saldo de gols", "goal_difference"],
  ["points", "points"],
  ["pontos", "points"],
  ["clean sheet", "clean_sheet"],
  ["clean_sheet", "clean_sheet"],
  ["sem sofrer gol", "clean_sheet"],
  ["failed to score", "failed_to_score"],
  ["failed_to_score", "failed_to_score"],
  ["sem marcar", "failed_to_score"],
  ["both teams scored", "both_teams_scored"],
  ["both_teams_scored", "both_teams_scored"],
  ["ambos marcaram", "both_teams_scored"],
  ["btts", "both_teams_scored"],
  ["venue", "venue"],
  ["mando", "venue"],
  ["competition", "competition"],
  ["competicao", "competition"],
  ["opponent", "opponent"],
  ["adversario", "opponent"],
]);

const OPERATORS = new Map<string, string>([
  ["eq", "eq"],
  ["=", "eq"],
  ["igual", "eq"],
  ["neq", "neq"],
  ["!=", "neq"],
  ["diferente", "neq"],
  ["gt", "gt"],
  [">", "gt"],
  ["maior que", "gt"],
  ["gte", "gte"],
  [">=", "gte"],
  ["maior ou igual", "gte"],
  ["pelo menos", "gte"],
  ["no minimo", "gte"],
  ["lt", "lt"],
  ["<", "lt"],
  ["menor que", "lt"],
  ["lte", "lte"],
  ["<=", "lte"],
  ["menor ou igual", "lte"],
  ["no maximo", "lte"],
  ["in", "in"],
  ["em", "in"],
]);

const GROUPS = new Map<string, string>([
  ["venue", "venue"],
  ["mando", "venue"],
  ["casa e fora", "venue"],
  ["competition", "competition"],
  ["competicao", "competition"],
  ["season", "season"],
  ["temporada", "season"],
  ["opponent", "opponent"],
  ["adversario", "opponent"],
  ["month", "month"],
  ["mes", "month"],
  ["year", "year"],
  ["ano", "year"],
  ["outcome", "outcome"],
  ["resultado", "outcome"],
]);

function normalizeOutcome(value: unknown): unknown {
  const key = token(value);
  if (!key) return value;
  if (["win", "won", "vitoria", "venceu", "vitorias"].includes(key)) return "win";
  if (["draw", "empate", "empatou", "empates"].includes(key)) return "draw";
  if (["loss", "lost", "derrota", "perdeu", "derrotas"].includes(key)) return "loss";
  return value;
}

function normalizeVenue(value: unknown): unknown {
  const key = token(value);
  if (!key) return value;
  if (["home", "casa", "mandante", "em casa"].includes(key)) return "home";
  if (["away", "fora", "visitante", "fora de casa"].includes(key)) return "away";
  if (["all", "todos", "casa e fora"].includes(key)) return "all";
  return value;
}

function normalizeBoolean(value: unknown): unknown {
  if (typeof value === "boolean") return value;
  const key = token(value);
  if (["true", "sim", "yes", "1"].includes(key ?? "")) return true;
  if (["false", "nao", "no", "0"].includes(key ?? "")) return false;
  return value;
}

function normalizeFilterValue(field: string, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeFilterValue(field, item));
  if (field === "outcome") return normalizeOutcome(value);
  if (field === "venue") return normalizeVenue(value);
  if (field === "competition") return normalizeCompetition(value);
  if (["clean_sheet", "failed_to_score", "both_teams_scored"].includes(field))
    return normalizeBoolean(value);
  if (["goals_for", "goals_against", "goal_difference", "points"].includes(field)) {
    if (typeof value === "number") return value;
    if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
      return Number(value.trim());
  }
  return value;
}

function normalizeFilters(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];
    const fieldKey = token(record.field ?? record.metric);
    const operatorKey = token(record.operator ?? record.op);
    const field = fieldKey ? FILTER_FIELDS.get(fieldKey) : null;
    const operator = operatorKey ? OPERATORS.get(operatorKey) : null;
    if (!field || !operator || !Object.prototype.hasOwnProperty.call(record, "value")) return [];
    return [{ field, operator, value: normalizeFilterValue(field, record.value) }];
  });
}

function normalizeGroups(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  const result: string[] = [];
  for (const item of values) {
    const key = token(item);
    const group = key ? GROUPS.get(key) : null;
    if (group && !result.includes(group)) result.push(group);
  }
  return result;
}

function normalizeSort(value: unknown): unknown {
  if (typeof value === "string") {
    const direction = token(value);
    if (direction === "asc" || direction === "desc") return { field: "value", direction };
    return undefined;
  }
  const record = asRecord(value);
  if (!record) return undefined;
  const direction = token(record.direction ?? record.order);
  if (direction !== "asc" && direction !== "desc") return undefined;
  const fieldKey = token(record.field ?? record.by ?? "value");
  const field =
    fieldKey === "sample size" || fieldKey === "sample_size"
      ? "sample_size"
      : fieldKey === "group" || fieldKey === "grupo"
        ? "group"
        : "value";
  return { field, direction };
}

/**
 * Phase 4C deterministic normalization sits after the semantic LLM output and before strict Zod.
 * The legacy normalizer remains the compatibility base for entity/query-kind/metric aliases.
 */
export function normalizeUniversalQueryPlanCandidate(value: unknown): unknown {
  const base = normalizeQueryPlanCandidate(value);
  const baseRecord = asRecord(base);
  if (!baseRecord || baseRecord.error) return base;

  const raw = asRecord(value) ?? {};
  const rawScope = asRecord(raw.scope) ?? {};
  const baseScope = asRecord(baseRecord.scope) ?? {};
  const queryKind = baseRecord.query_kind;
  const rawMetricToken = token(raw.metric ?? raw.statistic ?? raw.stat);
  const isPointsEfficiency = ["aproveitamento", "aproveitamento de pontos", "points efficiency"].includes(
    rawMetricToken ?? "",
  );
  const normalizedMetric = rawMetricToken ? METRICS.get(rawMetricToken) : undefined;

  const scope = {
    ...baseScope,
    ...(rawScope.season !== undefined ? { season: normalizeSeason(rawScope.season) } : {}),
    ...(raw.season !== undefined && rawScope.season === undefined
      ? { season: normalizeSeason(raw.season) }
      : {}),
    ...(rawScope.competition !== undefined
      ? { competition: normalizeCompetition(rawScope.competition) }
      : {}),
    ...(raw.competition !== undefined && rawScope.competition === undefined
      ? { competition: normalizeCompetition(raw.competition) }
      : {}),
  } as JsonRecord;

  const filters = normalizeFilters(raw.filters ?? raw.filter ?? []);
  const groupBy = normalizeGroups(raw.group_by ?? raw.groupBy ?? raw.groupby);
  const rawLimit = finiteInt(raw.limit);
  const existingEventLimit = finiteInt(scope.limit);
  const normalizedSort = normalizeSort(raw.sort);

  if (queryKind === "event_list" && existingEventLimit === undefined && rawLimit !== undefined) {
    scope.limit = rawLimit;
  }

  return {
    ...baseRecord,
    ...(normalizedMetric ? { metric: normalizedMetric } : {}),
    ...(isPointsEfficiency ? { metric: "points", aggregation: "percentage" } : {}),
    scope,
    filters,
    group_by: groupBy,
    ...(normalizedSort ? { sort: normalizedSort } : {}),
    ...(queryKind !== "event_list" && rawLimit !== undefined ? { limit: rawLimit } : {}),
  };
}
