import { z } from "zod";

export const SUPPORTED_MATCH_COUNTS = [1, 3, 5, 10, 15, 20] as const;

export const supportedMatchCountSchema = z.union([
  z.literal(1),
  z.literal(3),
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(20),
]);

export const analysisVenueSchema = z.enum(["all", "home", "away"]);

export const analysisOverridesSchema = z
  .object({
    match_count: supportedMatchCountSchema.optional(),
    competition: z.string().trim().min(2).max(100).nullable().optional(),
    venue: analysisVenueSchema.optional(),
  })
  .strict();

export const analysisRequestSchema = z
  .object({
    question: z.string().trim().min(3).max(500),
    idempotency_key: z.string().uuid(),
    overrides: analysisOverridesSchema.optional(),
  })
  .strict();

export type SupportedMatchCount = z.infer<typeof supportedMatchCountSchema>;
export type AnalysisVenue = z.infer<typeof analysisVenueSchema>;
export type AnalysisOverrides = z.infer<typeof analysisOverridesSchema>;
export type AnalysisRequest = z.infer<typeof analysisRequestSchema>;
