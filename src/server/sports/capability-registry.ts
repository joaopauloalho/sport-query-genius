import type {
  FootballEntityType,
  FootballEventType,
  FootballQueryKind,
  QueryPlan,
} from "@/server/analysis/query-plan";
import {
  getFootballMetricDefinition,
  metricIsSupportedForEntity,
  type FootballMetric,
  type MetricProvider,
} from "./metric-catalog";

const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export const FOOTBALL_CACHE_FAMILIES = {
  entity_identity: { ttlMs: 30 * DAY_MS },
  league_season: { ttlMs: DAY_MS },
  standings: { ttlMs: 10 * MINUTE_MS },
  fixtures: { ttlMs: 5 * MINUTE_MS },
  finished_match_detail: { ttlMs: 30 * DAY_MS },
  live: { ttlMs: 20 * SECOND_MS },
  team_stats: { ttlMs: 10 * MINUTE_MS },
  player_stats: { ttlMs: 10 * MINUTE_MS },
  incidents_finished: { ttlMs: 30 * DAY_MS },
  incidents_live: { ttlMs: 30 * SECOND_MS },
  lineups_predicted: { ttlMs: 10 * MINUTE_MS },
  lineups_final: { ttlMs: 30 * DAY_MS },
  squad: { ttlMs: 6 * HOUR_MS },
  availability: { ttlMs: 2 * HOUR_MS },
  transfers: { ttlMs: DAY_MS },
  people_places: { ttlMs: DAY_MS },
  odds: { ttlMs: 5 * MINUTE_MS, providerFreshnessPreferred: true },
  prediction: { ttlMs: 30 * MINUTE_MS },
} as const;

export type FootballCacheFamily = keyof typeof FOOTBALL_CACHE_FAMILIES;
export type CapabilityStage = "implemented" | "planned";

export interface ProviderCapabilitySource {
  provider: MetricProvider;
  endpoint: string;
  dataFamily: string;
  fallback: boolean;
  conditionalCoverage: boolean;
  paidAddonRequired?: boolean;
}

export interface FootballCapabilityDefinition {
  entityType: FootballEntityType;
  queryKind: FootballQueryKind;
  stage: CapabilityStage;
  cacheFamily: FootballCacheFamily;
  sources: readonly ProviderCapabilitySource[];
  events?: readonly FootballEventType[];
  note?: string;
}

const source = (
  provider: MetricProvider,
  endpoint: string,
  dataFamily: string,
  options: Partial<Omit<ProviderCapabilitySource, "provider" | "endpoint" | "dataFamily">> = {},
): ProviderCapabilitySource => ({
  provider,
  endpoint,
  dataFamily,
  fallback: options.fallback ?? provider === "API_FOOTBALL",
  conditionalCoverage: options.conditionalCoverage ?? true,
  ...(options.paidAddonRequired ? { paidAddonRequired: true } : {}),
});

const CAPABILITIES: FootballCapabilityDefinition[] = [
  {
    entityType: "team",
    queryKind: "aggregate",
    stage: "implemented",
    cacheFamily: "team_stats",
    sources: [
      source("BSD", "/events/ + /events/{event_id}/stats/", "fixture_score_or_stats", { conditionalCoverage: true }),
      source("API_FOOTBALL", "/fixtures + /fixtures/statistics", "fixture_score_or_stats", { conditionalCoverage: true }),
    ],
    note: "Only the legacy metric subset is executable in Phase 4A; the registry exposes broader provider coverage separately.",
  },
  {
    entityType: "player",
    queryKind: "aggregate",
    stage: "implemented",
    cacheFamily: "player_stats",
    sources: [source("BSD", "/players/{player_id}/stats/ + /events/{event_id}/player-stats/", "player_match_stats")],
  },
  {
    entityType: "player",
    queryKind: "event_list",
    stage: "implemented",
    cacheFamily: "incidents_finished",
    events: ["goal"],
    sources: [source("BSD", "/events/{event_id}/stats/ shotmap", "shotmap")],
  },
  {
    entityType: "team",
    queryKind: "event_list",
    stage: "planned",
    cacheFamily: "incidents_finished",
    events: ["goal", "assist", "yellow_card", "red_card", "substitution", "var", "penalty"],
    sources: [
      source("BSD", "/events/{event_id}/incidents/", "incidents", { conditionalCoverage: false }),
      source("API_FOOTBALL", "/fixtures/events", "incidents"),
    ],
  },
  {
    entityType: "team",
    queryKind: "match_list",
    stage: "planned",
    cacheFamily: "fixtures",
    sources: [source("BSD", "/events/", "fixtures", { conditionalCoverage: false }), source("API_FOOTBALL", "/fixtures", "fixtures")],
  },
  {
    entityType: "team",
    queryKind: "schedule",
    stage: "planned",
    cacheFamily: "fixtures",
    sources: [source("BSD", "/events/", "fixtures", { conditionalCoverage: false }), source("API_FOOTBALL", "/fixtures", "fixtures")],
  },
  {
    entityType: "team",
    queryKind: "head_to_head",
    stage: "planned",
    cacheFamily: "fixtures",
    sources: [source("BSD", "/events/{event_id}/h2h/", "head_to_head"), source("API_FOOTBALL", "/fixtures/headtohead", "head_to_head")],
  },
  {
    entityType: "team",
    queryKind: "comparison",
    stage: "planned",
    cacheFamily: "team_stats",
    sources: [source("BSD", "/events/ + /events/{event_id}/stats/", "fixture_score_or_stats"), source("API_FOOTBALL", "/fixtures + /fixtures/statistics", "fixture_score_or_stats")],
  },
  {
    entityType: "player",
    queryKind: "comparison",
    stage: "planned",
    cacheFamily: "player_stats",
    sources: [source("BSD", "/players/{player_id}/stats/ + /events/{event_id}/player-stats/", "player_match_stats")],
  },
  {
    entityType: "competition",
    queryKind: "standings",
    stage: "planned",
    cacheFamily: "standings",
    sources: [source("BSD", "/leagues/{league_id}/standings/?season_id=…", "standings"), source("API_FOOTBALL", "/standings", "standings")],
  },
  {
    entityType: "competition",
    queryKind: "ranking",
    stage: "planned",
    cacheFamily: "standings",
    sources: [source("BSD", "/leagues/{league_id}/… leaderboards", "leaderboards"), source("API_FOOTBALL", "/players/topscorers|topassists|topyellowcards|topredcards", "leaderboards")],
  },
  {
    entityType: "team",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "entity_identity",
    sources: [source("BSD", "/teams/{team_id}/", "team_profile", { conditionalCoverage: false }), source("API_FOOTBALL", "/teams", "team_profile")],
  },
  {
    entityType: "player",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "entity_identity",
    sources: [source("BSD", "/players/{player_id}/", "player_profile", { conditionalCoverage: false }), source("API_FOOTBALL", "/players", "player_profile")],
  },
  {
    entityType: "team",
    queryKind: "squad",
    stage: "planned",
    cacheFamily: "squad",
    sources: [source("BSD", "/teams/{team_id}/squad/", "squad"), source("API_FOOTBALL", "/players/squads", "squad")],
  },
  {
    entityType: "team",
    queryKind: "availability",
    stage: "planned",
    cacheFamily: "availability",
    sources: [source("BSD", "/teams/{team_id}/squad/ availability", "availability"), source("API_FOOTBALL", "/injuries + /sidelined", "availability")],
  },
  {
    entityType: "player",
    queryKind: "availability",
    stage: "planned",
    cacheFamily: "availability",
    sources: [source("BSD", "/teams/{team_id}/squad/ availability", "availability"), source("API_FOOTBALL", "/injuries + /sidelined", "availability")],
  },
  {
    entityType: "team",
    queryKind: "lineup",
    stage: "planned",
    cacheFamily: "lineups_predicted",
    sources: [source("BSD", "/events/{event_id}/lineups/", "lineup"), source("API_FOOTBALL", "/fixtures/lineups", "lineup")],
  },
  {
    entityType: "match",
    queryKind: "lineup",
    stage: "planned",
    cacheFamily: "lineups_predicted",
    sources: [source("BSD", "/events/{event_id}/lineups/", "lineup"), source("API_FOOTBALL", "/fixtures/lineups", "lineup")],
  },
  {
    entityType: "match",
    queryKind: "match_detail",
    stage: "planned",
    cacheFamily: "finished_match_detail",
    sources: [source("BSD", "/events/{event_id}/ + subresources", "match_detail"), source("API_FOOTBALL", "/fixtures?id=… + fixture subresources", "match_detail")],
  },
  {
    entityType: "team",
    queryKind: "transfer_list",
    stage: "planned",
    cacheFamily: "transfers",
    sources: [source("BSD", "/transfers/ or /players/{player_id}/transfers/", "transfers"), source("API_FOOTBALL", "/transfers", "transfers")],
  },
  {
    entityType: "player",
    queryKind: "transfer_list",
    stage: "planned",
    cacheFamily: "transfers",
    sources: [source("BSD", "/players/{player_id}/transfers/", "transfers"), source("API_FOOTBALL", "/transfers", "transfers")],
  },
  {
    entityType: "manager",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "people_places",
    sources: [source("BSD", "/managers/ + /managers/{manager_id}/", "manager_profile"), source("API_FOOTBALL", "/coachs", "manager_profile")],
  },
  {
    entityType: "manager",
    queryKind: "match_list",
    stage: "planned",
    cacheFamily: "fixtures",
    sources: [source("BSD", "/managers/{manager_id}/ + events", "manager_matches")],
  },
  {
    entityType: "referee",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "people_places",
    sources: [source("BSD", "/referees/ + referee detail", "referee_profile")],
  },
  {
    entityType: "referee",
    queryKind: "aggregate",
    stage: "planned",
    cacheFamily: "team_stats",
    sources: [source("BSD", "/referees/ + events/incidents", "referee_match_stats")],
  },
  {
    entityType: "venue",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "people_places",
    sources: [source("BSD", "/venues/ + /venues/{venue_id}/", "venue_profile"), source("API_FOOTBALL", "/venues", "venue_profile")],
  },
  {
    entityType: "match",
    queryKind: "odds",
    stage: "planned",
    cacheFamily: "odds",
    sources: [source("BSD", "/events/{event_id}/odds/ or /odds/", "consensus_odds"), source("API_FOOTBALL", "/odds", "bookmaker_odds")],
    note: "BSD best-price/per-bookmaker Unlimited endpoints are deliberately excluded from the free capability path.",
  },
  {
    entityType: "match",
    queryKind: "prediction",
    stage: "planned",
    cacheFamily: "prediction",
    sources: [source("BSD", "/events/{event_id}/prediction/ or /predictions/", "model_prediction"), source("API_FOOTBALL", "/predictions", "model_prediction")],
  },
  {
    entityType: "match",
    queryKind: "live_status",
    stage: "planned",
    cacheFamily: "live",
    sources: [source("BSD", "/events/live/ + match subresources", "live_rest"), source("API_FOOTBALL", "/fixtures?live=…", "live_rest")],
    note: "REST is sufficient for this phase; paid WebSocket is not required.",
  },
];

const LEGACY_TEAM_AGGREGATE_METRICS = new Set<FootballMetric>([
  "goals_for",
  "corners",
  "shots",
  "shots_on_target",
  "cards",
]);
const LEGACY_PLAYER_AGGREGATE_METRICS = new Set<FootballMetric>([
  "goals",
  "shots",
  "shots_on_target",
  "cards",
]);

export interface CapabilityResolution {
  supported: boolean;
  stage: CapabilityStage | "unsupported";
  capability: FootballCapabilityDefinition | null;
  sources: readonly ProviderCapabilitySource[];
  reason: string | null;
}

function baseCapability(plan: QueryPlan): FootballCapabilityDefinition | null {
  return CAPABILITIES.find(
    (entry) => entry.entityType === plan.entity.type && entry.queryKind === plan.query_kind,
  ) ?? null;
}

export function resolveFootballCapability(plan: QueryPlan): CapabilityResolution {
  const capability = baseCapability(plan);
  if (!capability) {
    return {
      supported: false,
      stage: "unsupported",
      capability: null,
      sources: [],
      reason: `No ${plan.entity.type}/${plan.query_kind} capability is registered.`,
    };
  }

  if (plan.metric) {
    if (plan.entity.type !== "team" && plan.entity.type !== "player") {
      return {
        supported: false,
        stage: "unsupported",
        capability,
        sources: capability.sources,
        reason: `Metric ${plan.metric} is not attached to entity type ${plan.entity.type}.`,
      };
    }
    if (!metricIsSupportedForEntity(plan.metric, plan.entity.type)) {
      return {
        supported: false,
        stage: "unsupported",
        capability,
        sources: capability.sources,
        reason: `Metric ${plan.metric} is not catalogued for ${plan.entity.type}.`,
      };
    }
  }

  if (plan.event_type && capability.events && !capability.events.includes(plan.event_type)) {
    return {
      supported: false,
      stage: "unsupported",
      capability,
      sources: capability.sources,
      reason: `Event ${plan.event_type} is not registered for ${plan.entity.type}/${plan.query_kind}.`,
    };
  }

  let stage = capability.stage;
  if (plan.query_kind === "aggregate" && plan.metric) {
    if (plan.entity.type === "team" && !LEGACY_TEAM_AGGREGATE_METRICS.has(plan.metric)) stage = "planned";
    if (plan.entity.type === "player" && !LEGACY_PLAYER_AGGREGATE_METRICS.has(plan.metric)) stage = "planned";
  }
  if (
    plan.entity.type === "player" &&
    plan.query_kind === "event_list" &&
    plan.event_type !== "goal"
  ) {
    stage = "planned";
  }

  const metricSources =
    plan.metric && (plan.entity.type === "team" || plan.entity.type === "player")
      ? Object.entries(getFootballMetricDefinition(plan.metric, plan.entity.type)?.providers ?? {}).map(
          ([provider, mapping]) =>
            source(
              provider as MetricProvider,
              mapping!.endpoint,
              mapping!.dataFamily,
              {
                fallback: provider === "API_FOOTBALL",
                conditionalCoverage: mapping!.coverage === "conditional",
              },
            ),
        )
      : capability.sources;

  return {
    supported: true,
    stage,
    capability,
    sources: metricSources.length > 0 ? metricSources : capability.sources,
    reason: stage === "implemented" ? null : "Capability is provider-backed but not yet wired to a deterministic result engine in this phase.",
  };
}

export const footballCapabilities = CAPABILITIES;
