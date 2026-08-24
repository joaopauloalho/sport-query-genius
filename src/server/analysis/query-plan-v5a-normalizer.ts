import { FOOTBALL_METRIC_KEYS } from "../sports/metric-catalog";
import { canonicalizeCompetitionName } from "../sports/competition-season-registry";
import { normalizeQueryPlanCandidate } from "./query-plan-normalizer";
import { normalizeUniversalQueryPlanCandidate } from "./query-plan-v4c-normalizer";

type JsonRecord = Record<string, unknown>;

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

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

const canonicalToken = (value: unknown): string => (token(value) ?? "unknown").replace(/\s+/g, "_");

function metricField(value: unknown, raw: JsonRecord): string | null {
  const normalized = normalizeQueryPlanCandidate({
    sport: "football",
    entity: asRecord(raw.entity) ?? { type: "team", name: "semantic-filter" },
    query_kind: "aggregate",
    metric: value,
    aggregation: "average",
    scope: { venue: "all", half: "full" },
  });
  const metric = asRecord(normalized)?.metric;
  return typeof metric === "string" && FOOTBALL_METRIC_KEYS.includes(metric as never) ? metric : null;
}

const OPERATORS: Record<string, string> = {
  eq: "eq", "=": "eq", igual: "eq",
  neq: "neq", "!=": "neq", diferente: "neq",
  gt: "gt", ">": "gt", "maior que": "gt",
  gte: "gte", ">=": "gte", "maior ou igual": "gte", "pelo menos": "gte", "no minimo": "gte",
  lt: "lt", "<": "lt", "menor que": "lt",
  lte: "lte", "<=": "lte", "menor ou igual": "lte", "no maximo": "lte",
  in: "in", em: "in",
};

function truthfulFilters(raw: JsonRecord): unknown[] {
  const source = raw.filters ?? raw.filter;
  if (!Array.isArray(source)) return [];
  return source.map((item) => {
    const record = asRecord(item);
    if (!record) return { field: "invalid_filter", operator: "invalid", value: String(item) };

    // Reuse the proven Phase 4C normalizer when it recognizes the complete filter.
    const isolated = normalizeUniversalQueryPlanCandidate({ ...raw, filters: [item], group_by: [] });
    const normalizedFilter = asRecord(isolated)?.filters;
    if (Array.isArray(normalizedFilter) && normalizedFilter.length === 1) return normalizedFilter[0];

    const fieldValue = record.field ?? record.metric;
    const canonicalMetric = metricField(fieldValue, raw);
    const fieldToken = token(fieldValue);
    const baseAliases: Record<string, string> = {
      resultado: "outcome",
      "resultado da partida": "outcome",
      mando: "venue",
      competicao: "competition",
      adversario: "opponent",
      "sem sofrer gol": "clean_sheet",
      "sem marcar": "failed_to_score",
      "ambos marcaram": "both_teams_scored",
      btts: "both_teams_scored",
    };
    const field = canonicalMetric ?? (fieldToken ? baseAliases[fieldToken] : null) ?? canonicalToken(fieldValue);
    const operatorKey = token(record.operator ?? record.op);
    const operator = (operatorKey ? OPERATORS[operatorKey] : null) ?? canonicalToken(record.operator ?? record.op);
    return {
      field,
      operator,
      ...(Object.prototype.hasOwnProperty.call(record, "value") ? { value: record.value } : { value: "missing_value" }),
    };
  });
}

function truthfulGroups(raw: JsonRecord): string[] {
  const source = raw.group_by ?? raw.groupBy ?? raw.groupby;
  const items = Array.isArray(source) ? source : source == null ? [] : [source];
  return items.map((item) => {
    const isolated = normalizeUniversalQueryPlanCandidate({ ...raw, filters: [], group_by: [item] });
    const normalized = asRecord(isolated)?.group_by;
    if (Array.isArray(normalized) && normalized.length === 1 && typeof normalized[0] === "string") return normalized[0];
    return canonicalToken(item);
  });
}

function truthfulSort(raw: JsonRecord): unknown {
  const sort = raw.sort;
  if (sort === undefined) return undefined;
  if (typeof sort === "string") return { field: "value", direction: canonicalToken(sort) };
  const record = asRecord(sort);
  if (!record) return { field: "invalid_sort", direction: "invalid" };
  const fieldToken = token(record.field ?? record.by ?? "value");
  const field =
    fieldToken === "sample size" || fieldToken === "sample_size"
      ? "sample_size"
      : fieldToken === "grupo" || fieldToken === "group"
        ? "group"
        : fieldToken === "value" || fieldToken === "valor"
          ? "value"
          : canonicalToken(record.field ?? record.by);
  return { field, direction: canonicalToken(record.direction ?? record.order) };
}

/**
 * Phase 5A semantic normalization: use legacy normalization for known vocabulary, then restore
 * every semantic filter/group/sort request from the raw candidate. Unknown constraints remain
 * visible so the capability negotiator can reject them instead of silently simplifying the query.
 */
export function normalizeTruthfulSemanticCandidate(value: unknown): unknown {
  const base = normalizeUniversalQueryPlanCandidate(value);
  const baseRecord = asRecord(base);
  const raw = asRecord(value);
  if (!baseRecord || baseRecord.error || !raw) return base;

  const scope = asRecord(baseRecord.scope) ?? {};
  const rawScope = asRecord(raw.scope) ?? {};
  const competition = rawScope.competition ?? raw.competition;

  return {
    ...baseRecord,
    scope: {
      ...scope,
      ...(typeof competition === "string" ? { competition: canonicalizeCompetitionName(competition) } : {}),
    },
    filters: truthfulFilters(raw),
    group_by: truthfulGroups(raw),
    ...(raw.sort !== undefined ? { sort: truthfulSort(raw) } : {}),
  };
}
