import {
  getFootballMetricDefinition,
  type FootballMetric,
  type TeamMetric,
} from "./metric-catalog";

export type ExecutableTeamRawMetric = TeamMetric;

export type TeamMetricExecutionPlan =
  | {
      kind: "derived";
      metric: FootballMetric;
      dataFamily: "fixture_score";
      rawMetric: null;
      providers: readonly string[];
      conditionalCoverage: boolean;
    }
  | {
      kind: "raw";
      metric: TeamMetric;
      dataFamily: "fixture_stats";
      rawMetric: ExecutableTeamRawMetric;
      providers: readonly string[];
      conditionalCoverage: boolean;
    }
  | {
      kind: "unsupported";
      metric: FootballMetric;
      dataFamily: string | null;
      rawMetric: null;
      providers: readonly string[];
      reason: string;
    };

const SCORE_DERIVED_TEAM_METRICS = new Set<FootballMetric>([
  "goals_for",
  "goals_against",
  "goal_difference",
  "wins",
  "draws",
  "losses",
  "points",
  "win_rate",
  "unbeaten_rate",
  "clean_sheets",
  "failed_to_score",
  "both_teams_scored",
]);

function providerName(value: string): string {
  return value === "API_FOOTBALL" ? "API-FOOTBALL" : value;
}

export function resolveTeamMetricExecution(metric: FootballMetric): TeamMetricExecutionPlan {
  const definition = getFootballMetricDefinition(metric, "team");
  const providers = definition
    ? Object.entries(definition.providers)
        .filter(([, mapping]) => mapping?.dataFamily === "fixture_stats")
        .map(([provider]) => providerName(provider))
    : [];

  if (!definition) {
    return {
      kind: "unsupported",
      metric,
      dataFamily: null,
      rawMetric: null,
      providers,
      reason: `A métrica ${metric} não está catalogada para time.`,
    };
  }

  if (SCORE_DERIVED_TEAM_METRICS.has(metric)) {
    return {
      kind: "derived",
      metric,
      dataFamily: "fixture_score",
      rawMetric: null,
      providers: ["BSD", "API-FOOTBALL"],
      conditionalCoverage: false,
    };
  }

  const fixtureStatsMappings = Object.values(definition.providers).filter(
    (mapping) => mapping?.dataFamily === "fixture_stats",
  );
  if (fixtureStatsMappings.length > 0) {
    return {
      kind: "raw",
      metric: metric as TeamMetric,
      dataFamily: "fixture_stats",
      rawMetric: metric as TeamMetric,
      providers,
      conditionalCoverage: fixtureStatsMappings.some(
        (mapping) => mapping?.coverage === "conditional",
      ),
    };
  }

  const family = Object.values(definition.providers)[0]?.dataFamily ?? null;
  return {
    kind: "unsupported",
    metric,
    dataFamily: family,
    rawMetric: null,
    providers,
    reason: `A métrica ${metric} está no catálogo, mas não possui mapping fixture_stats validado para execução universal por partida.`,
  };
}

export function isScoreDerivedTeamMetric(metric: FootballMetric): boolean {
  return SCORE_DERIVED_TEAM_METRICS.has(metric);
}

export function providersForTeamMetrics(metrics: readonly TeamMetric[]): string[] {
  const rawPlans = metrics
    .map(resolveTeamMetricExecution)
    .filter(
      (plan): plan is Extract<TeamMetricExecutionPlan, { kind: "raw" }> => plan.kind === "raw",
    );
  if (rawPlans.length === 0) return ["BSD", "API-FOOTBALL"];
  return rawPlans
    .slice(1)
    .reduce(
      (providers, plan) => providers.filter((provider) => plan.providers.includes(provider)),
      [...rawPlans[0].providers],
    );
}
