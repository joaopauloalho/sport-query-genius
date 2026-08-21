import type { AnalysisOverrides } from "@/lib/analysis-request";
import type { QueryIntentInput } from "./intent-schema";

export function applyOverrides(
  parsedIntent: QueryIntentInput,
  overrides?: AnalysisOverrides,
): QueryIntentInput {
  if (!overrides) return parsedIntent;

  const competitionWasOverridden = Object.prototype.hasOwnProperty.call(overrides, "competition");

  return {
    ...parsedIntent,
    match_count: overrides.match_count ?? parsedIntent.match_count,
    competition: competitionWasOverridden
      ? (overrides.competition ?? null)
      : parsedIntent.competition,
    venue: overrides.venue ?? parsedIntent.venue,
  };
}
