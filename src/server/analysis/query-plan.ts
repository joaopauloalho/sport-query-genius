import { z } from "zod";

import {
  FOOTBALL_METRIC_KEYS,
  type FootballMetric,
} from "@/server/sports/metric-catalog";

export const FOOTBALL_ENTITY_TYPES = [
  "team",
  "player",
  "competition",
  "match",
  "manager",
  "referee",
  "venue",
] as const;

export const FOOTBALL_QUERY_KINDS = [
  "aggregate",
  "event_list",
  "match_list",
  "match_detail",
  "comparison",
  "head_to_head",
  "standings",
  "ranking",
  "profile",
  "squad",
  "availability",
  "lineup",
  "transfer_list",
  "schedule",
  "live_status",
  "odds",
  "prediction",
] as const;

export const FOOTBALL_EVENT_TYPES = [
  "goal",
  "assist",
  "yellow_card",
  "red_card",
  "substitution",
  "var",
  "penalty",
] as const;

export const FOOTBALL_AGGREGATIONS = [
  "total",
  "average",
  "median",
  "minimum",
  "maximum",
  "count",
  "percentage",
  "rate",
] as const;

export const footballEntityTypeSchema = z.enum(FOOTBALL_ENTITY_TYPES);
export const footballQueryKindSchema = z.enum(FOOTBALL_QUERY_KINDS);
export const footballEventTypeSchema = z.enum(FOOTBALL_EVENT_TYPES);
export const footballAggregationSchema = z.enum(FOOTBALL_AGGREGATIONS);
export const footballMetricSchema = z.enum(
  FOOTBALL_METRIC_KEYS as [FootballMetric, ...FootballMetric[]],
);

export const queryEntitySchema = z
  .object({
    type: footballEntityTypeSchema,
    name: z.string().trim().min(1).max(120),
    resolved_id: z.union([z.string().min(1), z.number().int()]).optional(),
  })
  .strict();

export const queryScopeSchema = z
  .object({
    last_matches: z.number().int().min(1).max(20).optional(),
    limit: z.number().int().min(1).max(50).optional(),
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    season: z.string().trim().min(1).max(40).optional(),
    competition: z.string().trim().min(1).max(120).optional(),
    venue: z.enum(["home", "away", "all"]).default("all"),
    opponent: z.string().trim().min(1).max(120).optional(),
    half: z.enum(["first", "second", "full"]).default("full"),
    status: z.enum(["finished", "live", "upcoming"]).optional(),
  })
  .strict();

export const queryPlanSchema = z
  .object({
    sport: z.literal("football"),
    entity: queryEntitySchema,
    query_kind: footballQueryKindSchema,
    metric: footballMetricSchema.optional(),
    event_type: footballEventTypeSchema.optional(),
    aggregation: footballAggregationSchema.optional(),
    scope: queryScopeSchema.default({ venue: "all", half: "full" }),
    compare_with: queryEntitySchema.optional(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.query_kind === "aggregate") {
      if (!plan.metric) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["metric"],
          message: "aggregate requires metric",
        });
      }
      if (!plan.aggregation) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["aggregation"],
          message: "aggregate requires aggregation",
        });
      }
    }

    if (plan.query_kind === "event_list" && !plan.event_type) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["event_type"],
        message: "event_list requires event_type",
      });
    }

    if ((plan.query_kind === "comparison" || plan.query_kind === "head_to_head") && !plan.compare_with) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compare_with"],
        message: `${plan.query_kind} requires compare_with`,
      });
    }

    if (plan.query_kind === "head_to_head") {
      if (plan.entity.type !== "team" || plan.compare_with?.type !== "team") {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["entity"],
          message: "head_to_head currently models team versus team",
        });
      }
    }

    if (plan.scope.date_from && plan.scope.date_to && plan.scope.date_from > plan.scope.date_to) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["scope", "date_to"],
        message: "date_to must not be earlier than date_from",
      });
    }
  });

export const queryPlanResponseSchema = z.union([
  queryPlanSchema,
  z.object({ error: z.literal("question_not_understood") }).strict(),
]);

export type FootballEntityType = z.infer<typeof footballEntityTypeSchema>;
export type FootballQueryKind = z.infer<typeof footballQueryKindSchema>;
export type FootballEventType = z.infer<typeof footballEventTypeSchema>;
export type FootballAggregation = z.infer<typeof footballAggregationSchema>;
export type QueryEntity = z.infer<typeof queryEntitySchema>;
export type QueryScope = z.infer<typeof queryScopeSchema>;
export type QueryPlan = z.infer<typeof queryPlanSchema>;
export type QueryPlanResponse = z.infer<typeof queryPlanResponseSchema>;

export function queryPlanSignature(plan: QueryPlan): string {
  const comparable = {
    sport: plan.sport,
    entity_type: plan.entity.type,
    query_kind: plan.query_kind,
    metric: plan.metric ?? null,
    event_type: plan.event_type ?? null,
    aggregation: plan.aggregation ?? null,
    scope: {
      last_matches: plan.scope.last_matches ?? null,
      limit: plan.scope.limit ?? null,
      date_from: plan.scope.date_from ?? null,
      date_to: plan.scope.date_to ?? null,
      season: plan.scope.season ?? null,
      competition: plan.scope.competition ?? null,
      venue: plan.scope.venue,
      opponent: plan.scope.opponent ?? null,
      half: plan.scope.half,
      status: plan.scope.status ?? null,
    },
    compare_with_type: plan.compare_with?.type ?? null,
  };

  return JSON.stringify(comparable);
}
