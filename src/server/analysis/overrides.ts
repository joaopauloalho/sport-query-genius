import type { AnalysisOverrides } from "@/lib/analysis-request";
import type { QueryIntentInput } from "./intent-schema";

export function applyOverrides(
  parsedIntent: QueryIntentInput,
  overrides?: AnalysisOverrides,
): QueryIntentInput {
  if (!overrides) return parsedIntent;

  const competitionWasOverridden = Object.prototype.hasOwnProperty.call(overrides, "competition");
  const competition = competitionWasOverridden
    ? (overrides.competition ?? null)
    : parsedIntent.competition;

  if (parsedIntent.query_kind === "event_list") {
    return { ...parsedIntent, competition };
  }

  if (parsedIntent.entity_type === "player") {
    return {
      ...parsedIntent,
      match_count: overrides.match_count ?? parsedIntent.match_count,
      competition,
      venue: "all",
    };
  }

  return {
    ...parsedIntent,
    match_count: overrides.match_count ?? parsedIntent.match_count,
    competition,
    venue: overrides.venue ?? parsedIntent.venue,
  };
}
