import { z } from "zod";

export const MAX_ANALYSIS_MATCH_COUNT = 100;

/** Every technically accepted explicit match window. Kept for backwards-compatible route validation. */
export const SUPPORTED_MATCH_COUNTS: readonly number[] = Array.from(
  { length: MAX_ANALYSIS_MATCH_COUNT },
  (_, index) => index + 1,
);

/** Compact UI presets; natural-language and URL overrides still accept any integer from 1 to 100. */
export const MATCH_COUNT_PRESETS = [1, 3, 5, 7, 10, 12, 15, 20, 25, 30, 38, 50, 100] as const;

export const supportedMatchCountSchema = z
  .number()
  .int()
  .min(1)
  .max(MAX_ANALYSIS_MATCH_COUNT);

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
