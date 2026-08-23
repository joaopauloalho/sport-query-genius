import type {
  FootballEntityType,
  FootballEventType,
  FootballQueryKind,
  QueryPlan,
} from "../analysis/query-plan";
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

const bsdEvents = source("BSD", "/events/", "fixtures", { conditionalCoverage: false });
const apiFixtures = source("API_FOOTBALL", "/fixtures", "fixtures");
const bsdStats = source("BSD", "/events/{event_id}/stats/", "fixture_stats");
const apiStats = source("API_FOOTBALL", "/fixtures/statistics", "fixture_stats");
const bsdPlayerStats = source(
  "BSD",
  "/players/{player_id}/stats/ + /events/{event_id}/player-stats/",
  "player_match_stats",
);
const bsdIncidents = source("BSD", "/events/{event_id}/incidents/", "incidents", {
  conditionalCoverage: false,
});
const apiIncidents = source("API_FOOTBALL", "/fixtures/events", "incidents");
const bsdLineups = source("BSD", "/events/{event_id}/lineups/", "lineups");
const apiLineups = source("API_FOOTBALL", "/fixtures/lineups", "lineups");
const bsdStandings = source("BSD", "/leagues/{league_id}/standings/?season_id=…", "standings");
const apiStandings = source("API_FOOTBALL", "/standings", "standings");

const CAPABILITIES: FootballCapabilityDefinition[] = [
  {
    entityType: "team",
    queryKind: "aggregate",
    stage: "implemented",
    cacheFamily: "team_stats",
    sources: [bsdEvents, bsdStats, apiFixtures, apiStats],
    note: "Legacy deterministic aggregate subset remains active while broader catalog metrics migrate to universal executors.",
  },
  {
    entityType: "player",
    queryKind: "aggregate",
    stage: "implemented",
    cacheFamily: "player_stats",
    sources: [bsdPlayerStats],
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
    stage: "implemented",
    cacheFamily: "incidents_finished",
    events: ["goal", "assist", "yellow_card", "red_card", "substitution", "var", "penalty"],
    sources: [bsdIncidents, apiIncidents],
    note: "Phase 4B reads chronological incidents; BSD shotmap only enriches proven goal incidents with optional xG/body-part fields.",
  },
  {
    entityType: "team",
    queryKind: "match_list",
    stage: "implemented",
    cacheFamily: "fixtures",
    sources: [bsdEvents, apiFixtures],
  },
  {
    entityType: "team",
    queryKind: "schedule",
    stage: "implemented",
    cacheFamily: "fixtures",
    sources: [bsdEvents, apiFixtures],
  },
  {
    entityType: "team",
    queryKind: "head_to_head",
    stage: "implemented",
    cacheFamily: "fixtures",
    sources: [
      source("BSD", "/events/?team_id=… + resolved-opponent filter", "fixtures", {
        conditionalCoverage: false,
      }),
      source("API_FOOTBALL", "/fixtures?team=… + resolved-opponent filter", "fixtures"),
    ],
    note: "Phase 4B resolves both teams conservatively, filters fixture history by provider IDs, and calculates H2H deterministically. Dedicated provider H2H endpoints remain an optional future optimization.",
  },
  {
    entityType: "team",
    queryKind: "comparison",
    stage: "planned",
    cacheFamily: "team_stats",
    sources: [bsdEvents, bsdStats, apiFixtures, apiStats],
  },
  {
    entityType: "player",
    queryKind: "comparison",
    stage: "planned",
    cacheFamily: "player_stats",
    sources: [bsdPlayerStats],
  },
  {
    entityType: "team",
    queryKind: "standings",
    stage: "planned",
    cacheFamily: "standings",
    sources: [bsdStandings, apiStandings],
  },
  {
    entityType: "competition",
    queryKind: "standings",
    stage: "planned",
    cacheFamily: "standings",
    sources: [bsdStandings, apiStandings],
  },
  {
    entityType: "competition",
    queryKind: "ranking",
    stage: "planned",
    cacheFamily: "standings",
    sources: [
      source("BSD", "/leagues/{league_id}/ leaderboards", "leaderboards"),
      source(
        "API_FOOTBALL",
        "/players/topscorers|topassists|topyellowcards|topredcards",
        "leaderboards",
      ),
    ],
  },
  {
    entityType: "team",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "entity_identity",
    sources: [
      source("BSD", "/teams/{team_id}/", "team_profile", { conditionalCoverage: false }),
      source("API_FOOTBALL", "/teams", "team_profile"),
    ],
  },
  {
    entityType: "player",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "entity_identity",
    sources: [
      source("BSD", "/players/{player_id}/", "player_profile", {
        conditionalCoverage: false,
      }),
      source("API_FOOTBALL", "/players", "player_profile"),
    ],
  },
  {
    entityType: "team",
    queryKind: "squad",
    stage: "planned",
    cacheFamily: "squad",
    sources: [
      source("BSD", "/teams/{team_id}/squad/", "squad"),
      source("API_FOOTBALL", "/players/squads", "squad"),
    ],
  },
  {
    entityType: "team",
    queryKind: "availability",
    stage: "planned",
    cacheFamily: "availability",
    sources: [
      source("BSD", "/teams/{team_id}/squad/ availability", "availability"),
      source("API_FOOTBALL", "/injuries + /sidelined", "availability"),
    ],
  },
  {
    entityType: "player",
    queryKind: "availability",
    stage: "planned",
    cacheFamily: "availability",
    sources: [
      source("BSD", "/teams/{team_id}/squad/ availability", "availability"),
      source("API_FOOTBALL", "/injuries + /sidelined", "availability"),
    ],
  },
  {
    entityType: "team",
    queryKind: "lineup",
    stage: "planned",
    cacheFamily: "lineups_predicted",
    sources: [bsdLineups, apiLineups],
  },
  {
    entityType: "match",
    queryKind: "lineup",
    stage: "planned",
    cacheFamily: "lineups_predicted",
    sources: [bsdLineups, apiLineups],
  },
  {
    entityType: "match",
    queryKind: "match_detail",
    stage: "planned",
    cacheFamily: "finished_match_detail",
    sources: [
      source("BSD", "/events/{event_id}/ + stats/incidents/lineups", "match_detail"),
      source("API_FOOTBALL", "/fixtures?id=… + fixture subresources", "match_detail"),
    ],
  },
  {
    entityType: "team",
    queryKind: "transfer_list",
    stage: "planned",
    cacheFamily: "transfers",
    sources: [
      source("BSD", "/transfers/", "transfers"),
      source("API_FOOTBALL", "/transfers", "transfers"),
    ],
  },
  {
    entityType: "player",
    queryKind: "transfer_list",
    stage: "planned",
    cacheFamily: "transfers",
    sources: [
      source("BSD", "/players/{player_id}/transfers/", "transfers"),
      source("API_FOOTBALL", "/transfers", "transfers"),
    ],
  },
  {
    entityType: "manager",
    queryKind: "profile",
    stage: "planned",
    cacheFamily: "people_places",
    sources: [
      source("BSD", "/managers/ + /managers/{manager_id}/", "manager_profile"),
      source("API_FOOTBALL", "/coachs", "manager_profile"),
    ],
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
    sources: [source("BSD", "/referees/", "referee_profile")],
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
    sources: [
      source("BSD", "/venues/ + /venues/{venue_id}/", "venue_profile"),
      source("API_FOOTBALL", "/venues", "venue_profile"),
    ],
  },
  {
    entityType: "match",
    queryKind: "odds",
    stage: "planned",
    cacheFamily: "odds",
    sources: [
      source("BSD", "/events/{event_id}/odds/ or /odds/", "consensus_odds"),
      source("API_FOOTBALL", "/odds", "bookmaker_odds"),
    ],
    note: "Free-path registry deliberately excludes BSD Unlimited best-price/per-bookmaker endpoints.",
  },
  {
    entityType: "match",
    queryKind: "prediction",
    stage: "planned",
    cacheFamily: "prediction",
    sources: [
      source("BSD", "/events/{event_id}/prediction/ or /predictions/", "model_prediction"),
      source("API_FOOTBALL", "/predictions", "model_prediction"),
    ],
  },
  {
    entityType: "match",
    queryKind: "live_status",
    stage: "planned",
    cacheFamily: "live",
    sources: [
      source("BSD", "/events/live/ + match subresources", "live_rest"),
      source("API_FOOTBALL", "/fixtures?live=…", "live_rest"),
    ],
    note: "REST is the registered path for Phase 4; the optional paid WebSocket add-on is not required.",
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
const LEGACY_AGGREGATIONS = new Set(["average", "total", "median"]);

export interface CapabilityResolution {
  supported: boolean;
  stage: CapabilityStage | "unsupported";
  capability: FootballCapabilityDefinition | null;
  sources: readonly ProviderCapabilitySource[];
  reason: string | null;
}

export function getRegisteredCapability(
  entityType: FootballEntityType,
  queryKind: FootballQueryKind,
): FootballCapabilityDefinition | null {
  return (
    CAPABILITIES.find(
      (entry) => entry.entityType === entityType && entry.queryKind === queryKind,
    ) ?? null
  );
}

export function resolveFootballCapability(plan: QueryPlan): CapabilityResolution {
  const capability = getRegisteredCapability(plan.entity.type, plan.query_kind);
  if (!capability) {
    return {
      supported: false,
      stage: "unsupported",
      capability: null,
      sources: [],
      reason: `No ${plan.entity.type}/${plan.query_kind} capability is registered.`,
    };
  }

  const metricUsesEntityCatalog =
    Boolean(plan.metric) &&
    (plan.query_kind === "aggregate" || plan.query_kind === "comparison") &&
    (plan.entity.type === "team" || plan.entity.type === "player");

  if (
    metricUsesEntityCatalog &&
    plan.metric &&
    (plan.entity.type === "team" || plan.entity.type === "player") &&
    !metricIsSupportedForEntity(plan.metric, plan.entity.type)
  ) {
    return {
      supported: false,
      stage: "unsupported",
      capability,
      sources: capability.sources,
      reason: `Metric ${plan.metric} is not catalogued for ${plan.entity.type}.`,
    };
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
  if (plan.query_kind === "aggregate") {
    if (!plan.aggregation || !LEGACY_AGGREGATIONS.has(plan.aggregation)) stage = "planned";
    if (
      plan.metric &&
      plan.entity.type === "team" &&
      !LEGACY_TEAM_AGGREGATE_METRICS.has(plan.metric)
    ) {
      stage = "planned";
    }
    if (
      plan.metric &&
      plan.entity.type === "player" &&
      !LEGACY_PLAYER_AGGREGATE_METRICS.has(plan.metric)
    ) {
      stage = "planned";
    }
  }
  if (
    plan.entity.type === "player" &&
    plan.query_kind === "event_list" &&
    plan.event_type !== "goal"
  ) {
    stage = "planned";
  }

  const metricDefinition =
    plan.metric && (plan.entity.type === "team" || plan.entity.type === "player")
      ? getFootballMetricDefinition(plan.metric, plan.entity.type)
      : null;
  const metricSources = metricDefinition
    ? Object.entries(metricDefinition.providers).map(([provider, mapping]) =>
        source(provider as MetricProvider, mapping!.endpoint, mapping!.dataFamily, {
          fallback: provider === "API_FOOTBALL",
          conditionalCoverage: mapping!.coverage === "conditional",
        }),
      )
    : [];

  return {
    supported: true,
    stage,
    capability,
    sources: metricSources.length > 0 ? metricSources : capability.sources,
    reason:
      stage === "implemented"
        ? null
        : "Capability is provider-backed but not yet wired to a deterministic result engine in this phase.",
  };
}

export const footballCapabilities = CAPABILITIES;
