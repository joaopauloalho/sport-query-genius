import { z } from "zod";

import { analysisVenueSchema, supportedMatchCountSchema } from "@/lib/analysis-request";

export const SUPPORTED_METRICS = [
  "corners",
  "goals",
  "shots",
  "shots_on_target",
  "cards",
] as const;

export const queryIntentInputSchema = z
  .object({
    sport: z.literal("football"),
    entity_type: z.literal("team"),
    entity_name: z.string().trim().min(2).max(100),
    metric: z.enum(SUPPORTED_METRICS),
    aggregation: z.enum(["average", "total", "median"]),
    match_count: supportedMatchCountSchema,
    competition: z.string().trim().min(2).max(100).nullable(),
    venue: analysisVenueSchema,
  })
  .strict();

export type QueryIntentInput = z.infer<typeof queryIntentInputSchema>;

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
