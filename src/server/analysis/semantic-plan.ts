import { z } from "zod";

import {
  footballAggregationSchema,
  footballEntityTypeSchema,
  footballEventTypeSchema,
  footballMetricSchema,
  footballQueryKindSchema,
  queryEntitySchema,
  queryScopeSchema,
  type QueryEntity,
  type QueryScope,
} from "./query-plan";

type JsonRecord = Record<string, unknown>;

const filterValueSchema = z.union([
  z.string().trim().min(1).max(120),
  z.number().finite(),
  z.boolean(),
  z.array(z.union([z.string().trim().min(1).max(120), z.number().finite(), z.boolean()])).min(1).max(50),
]);

export const semanticFilterSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    operator: z.string().trim().min(1).max(40),
    value: filterValueSchema,
  })
  .strict();

export const semanticSortSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    direction: z.string().trim().min(1).max(20),
  })
  .strict();

export const semanticQuerySchema = z
  .object({
    sport: z.literal("football"),
    entity: queryEntitySchema,
    query_kind: footballQueryKindSchema,
    metric: footballMetricSchema.optional(),
    event_type: footballEventTypeSchema.optional(),
    aggregation: footballAggregationSchema.optional(),
    scope: queryScopeSchema.default({ venue: "all", half: "full" }),
    filters: z.array(semanticFilterSchema).max(12).default([]),
    group_by: z.array(z.string().trim().min(1).max(120)).max(3).default([]),
    sort: semanticSortSchema.optional(),
    limit: z.number().int().min(1).max(100).optional(),
    compare_with: queryEntitySchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.query_kind === "aggregate" && (!plan.metric || !plan.aggregation)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: !plan.metric ? ["metric"] : ["aggregation"],
        message: "aggregate requires metric and aggregation",
      });
    }
    if (plan.query_kind === "event_list" && !plan.event_type) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_type"],
        message: "event_list requires event_type",
      });
    }
    if (["comparison", "head_to_head"].includes(plan.query_kind) && !plan.compare_with) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compare_with"],
        message: `${plan.query_kind} requires compare_with`,
      });
    }
  });

export const semanticPlanResponseSchema = z.union([
  semanticQuerySchema,
  z.object({ error: z.literal("question_not_understood") }).strict(),
]);

export type SemanticFilter = z.infer<typeof semanticFilterSchema>;
export type SemanticSort = z.infer<typeof semanticSortSchema>;
export type SemanticQuery = z.infer<typeof semanticQuerySchema>;

export interface SemanticPreservationIssue {
  path: string;
  field: string;
  reason: "unknown_field" | "normalization_loss";
}

export interface SemanticPlan {
  version: 1;
  query: SemanticQuery;
  signature: string;
  preservation_issues: SemanticPreservationIssue[];
}

const TOP_LEVEL_KEYS = new Set([
  "sport", "entity", "entity_type", "entity_name", "query_kind", "metric", "statistic", "stat",
  "event_type", "aggregation", "scope", "filters", "filter", "group_by", "groupBy", "groupby", "sort",
  "limit", "compare_with", "match_count", "event_count", "date_from", "date_to", "season", "competition",
  "venue", "opponent", "half", "status",
]);
const SCOPE_KEYS = new Set([
  "last_matches", "limit", "date_from", "date_to", "season", "competition", "venue", "opponent", "half", "status",
]);
const ENTITY_KEYS = new Set(["type", "name", "resolved_id", "entity_type", "entity_name"]);
const FILTER_KEYS = new Set(["field", "metric", "operator", "op", "value"]);
const SORT_KEYS = new Set(["field", "by", "direction", "order"]);

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;

function unknownKeys(record: JsonRecord | null, allowed: Set<string>, path: string): SemanticPreservationIssue[] {
  if (!record) return [];
  return Object.keys(record)
    .filter((key) => !allowed.has(key))
    .map((key) => ({ path: `${path}.${key}`, field: key, reason: "unknown_field" as const }));
}

/**
 * Audit the semantic candidate before strict execution validation. This is deliberately
 * independent from the executable QueryPlan so unknown constraints cannot disappear while
 * normalizers evolve.
 */
export function auditSemanticPreservation(raw: unknown): SemanticPreservationIssue[] {
  const record = asRecord(raw);
  if (!record || record.error) return [];
  const issues = unknownKeys(record, TOP_LEVEL_KEYS, "$" );
  issues.push(...unknownKeys(asRecord(record.scope), SCOPE_KEYS, "$.scope"));
  issues.push(...unknownKeys(asRecord(record.entity), ENTITY_KEYS, "$.entity"));
  issues.push(...unknownKeys(asRecord(record.compare_with), ENTITY_KEYS, "$.compare_with"));

  const filters = Array.isArray(record.filters)
    ? record.filters
    : Array.isArray(record.filter)
      ? record.filter
      : [];
  filters.forEach((item, index) => {
    issues.push(...unknownKeys(asRecord(item), FILTER_KEYS, `$.filters[${index}]`));
  });
  issues.push(...unknownKeys(asRecord(record.sort), SORT_KEYS, "$.sort"));
  return issues;
}

export function createSemanticPlan(query: SemanticQuery, raw?: unknown): SemanticPlan {
  return {
    version: 1,
    query,
    signature: JSON.stringify(query),
    preservation_issues: raw === undefined ? [] : auditSemanticPreservation(raw),
  };
}

export type SemanticEntity = QueryEntity;
export type SemanticScope = QueryScope;
export {
  footballAggregationSchema,
  footballEntityTypeSchema,
  footballEventTypeSchema,
  footballMetricSchema,
  footballQueryKindSchema,
};
