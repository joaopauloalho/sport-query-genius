import { z } from "zod";

import { analysisVenueSchema, supportedMatchCountSchema } from "@/lib/analysis-request";

export const SUPPORTED_METRICS = [
  "corners",
  "goals",
  "shots",
  "shots_on_target",
  "cards",
] as const;

export const PLAYER_METRICS = ["goals", "shots", "shots_on_target", "cards"] as const;

const commonAggregateSchema = z.object({
  sport: z.literal("football"),
  query_kind: z.literal("aggregate"),
  entity_name: z.string().trim().min(2).max(100),
  aggregation: z.enum(["average", "total", "median"]),
  match_count: supportedMatchCountSchema,
  competition: z.string().trim().min(2).max(100).nullable(),
});

export const teamAggregateIntentInputSchema = commonAggregateSchema
  .extend({
    entity_type: z.literal("team"),
    metric: z.enum(SUPPORTED_METRICS),
    venue: analysisVenueSchema,
  })
  .strict();

export const playerAggregateIntentInputSchema = commonAggregateSchema
  .extend({
    entity_type: z.literal("player"),
    metric: z.enum(PLAYER_METRICS),
    venue: z.literal("all"),
  })
  .strict();

export const playerEventListIntentInputSchema = z
  .object({
    sport: z.literal("football"),
    query_kind: z.literal("event_list"),
    entity_type: z.literal("player"),
    entity_name: z.string().trim().min(2).max(100),
    metric: z.literal("goals"),
    event_type: z.literal("goal"),
    event_count: z.number().int().min(1).max(20),
    competition: z.string().trim().min(2).max(100).nullable(),
    venue: z.literal("all"),
  })
  .strict();

export const queryIntentInputSchema = z.union([
  teamAggregateIntentInputSchema,
  playerAggregateIntentInputSchema,
  playerEventListIntentInputSchema,
]);

export type QueryIntentInput = z.infer<typeof queryIntentInputSchema>;
export type TeamAggregateIntentInput = z.infer<typeof teamAggregateIntentInputSchema>;
export type PlayerAggregateIntentInput = z.infer<typeof playerAggregateIntentInputSchema>;
export type PlayerEventListIntentInput = z.infer<typeof playerEventListIntentInputSchema>;

/** @deprecated DeepSeek now emits QueryPlan. Kept for older tests and adapters. */
export const deepSeekIntentResponseSchema = z.union([
  queryIntentInputSchema,
  z
    .object({
      error: z.literal("question_not_understood"),
    })
    .strict(),
  z
    .object({
      error: z.literal("unsupported_metric"),
      metric: z.string().trim().min(1).max(80),
    })
    .strict(),
]);

export type DeepSeekIntentResponse = z.infer<typeof deepSeekIntentResponseSchema>;
