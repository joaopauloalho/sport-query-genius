import type { AnalysisOverrides } from "@/lib/analysis-request";
import type { SportsCacheObserver } from "@/server/sports/cache/cache-observer";
import { createUniversalFootballSources } from "@/server/sports/universal-provider.server";
import type { UniversalFootballSource } from "@/server/sports/universal-football";

import {
  analyzePhase4cUniversalTeamPlanWithSources,
  type Phase4cTeamResult,
} from "./analyze-team-universal.server";
import type { QueryPlan } from "./query-plan";

const HOUR_MS = 60 * 60 * 1_000;

// A recent/open-ended query should not trust one provider indefinitely when its newest
// completed fixture is already several days old. This is intentionally generic: it does
// not know team names, competitions or individual fixtures.
export const RECENT_FIXTURE_FRESHNESS_PROBE_AFTER_MS = 72 * HOUR_MS;
export const FRESHER_FIXTURE_TOLERANCE_MS = 90 * 60 * 1_000;

function requestedLastMatches(plan: QueryPlan, overrides?: AnalysisOverrides): number | undefined {
  return overrides?.match_count ?? plan.scope.last_matches;
}

export function shouldVerifyRecentFixtureFreshness(
  plan: QueryPlan,
  result: Phase4cTeamResult,
  overrides?: AnalysisOverrides,
  nowMs = Date.now(),
): boolean {
  if (!requestedLastMatches(plan, overrides)) return false;
  if ((plan.scope.status ?? "finished") !== "finished") return false;
  if (plan.scope.season || plan.scope.date_from || plan.scope.date_to) return false;

  const newest = newestResultFixtureTimestamp(result);
  if (newest === null || newest > nowMs) return false;
  return nowMs - newest >= RECENT_FIXTURE_FRESHNESS_PROBE_AFTER_MS;
}

export function newestResultFixtureTimestamp(result: Phase4cTeamResult): number | null {
  const timestamps = result.matches
    .map((match) => Date.parse(match.date))
    .filter((value) => Number.isFinite(value));
  return timestamps.length ? Math.max(...timestamps) : null;
}

async function analyzeWithSource(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
  source: UniversalFootballSource;
}): Promise<Phase4cTeamResult> {
  return analyzePhase4cUniversalTeamPlanWithSources({
    question: params.question,
    plan: params.plan,
    overrides: params.overrides,
    observer: params.observer,
    sources: [params.source],
  });
}

export async function analyzePhase4cWithFreshnessFallback(params: {
  question: string;
  plan: QueryPlan;
  overrides?: AnalysisOverrides;
  observer?: SportsCacheObserver;
  sources?: readonly UniversalFootballSource[];
  now?: Date;
}): Promise<Phase4cTeamResult> {
  const sources = params.sources ?? createUniversalFootballSources(params.observer);
  const initial = await analyzePhase4cUniversalTeamPlanWithSources({
    question: params.question,
    plan: params.plan,
    overrides: params.overrides,
    observer: params.observer,
    sources,
  });

  if (sources.length < 2) return initial;

  const nowMs = params.now?.getTime() ?? Date.now();
  if (!shouldVerifyRecentFixtureFreshness(params.plan, initial, params.overrides, nowMs)) {
    return initial;
  }

  const initialProvider = initial.provenance.provider;
  const initialSourceIndex = sources.findIndex((source) => source.name === initialProvider);
  if (initialSourceIndex < 0 || initialSourceIndex >= sources.length - 1) return initial;

  let best = initial;
  let bestNewest = newestResultFixtureTimestamp(initial);

  console.info("[phase4c-query] freshness verification required", {
    provider: initialProvider,
    newest_fixture_at: bestNewest === null ? null : new Date(bestNewest).toISOString(),
    age_hours: bestNewest === null ? null : Math.round((nowMs - bestNewest) / HOUR_MS),
  });

  for (const source of sources.slice(initialSourceIndex + 1)) {
    try {
      const candidate = await analyzeWithSource({
        question: params.question,
        plan: params.plan,
        overrides: params.overrides,
        observer: params.observer,
        source,
      });
      const candidateNewest = newestResultFixtureTimestamp(candidate);

      console.info("[phase4c-query] freshness candidate", {
        current_provider: best.provenance.provider,
        candidate_provider: source.name,
        current_newest_fixture_at: bestNewest === null ? null : new Date(bestNewest).toISOString(),
        candidate_newest_fixture_at:
          candidateNewest === null ? null : new Date(candidateNewest).toISOString(),
      });

      if (
        candidateNewest !== null &&
        (bestNewest === null || candidateNewest > bestNewest + FRESHER_FIXTURE_TOLERANCE_MS)
      ) {
        best = candidate;
        bestNewest = candidateNewest;
      }
    } catch (error) {
      // Freshness verification is a secondary confidence check. A successful primary result
      // remains available when the secondary provider is unavailable or lacks the capability.
      console.warn("[phase4c-query] freshness verification failed", {
        provider: source.name,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (best !== initial) {
    console.warn("[phase4c-query] fresher provider selected", {
      from: initialProvider,
      to: best.provenance.provider,
      previous_newest_fixture_at:
        newestResultFixtureTimestamp(initial) === null
          ? null
          : new Date(newestResultFixtureTimestamp(initial)!).toISOString(),
      selected_newest_fixture_at:
        bestNewest === null ? null : new Date(bestNewest).toISOString(),
    });
  }

  return best;
}
