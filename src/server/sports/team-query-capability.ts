import { getFootballMetricDefinition, type FootballMetric } from "./metric-catalog";

export type ExecutableTeamRawMetric = "corners" | "shots" | "shots_on_target" | "cards";

export type TeamMetricExecutionPlan =
  | {
      kind: "derived";
      metric: FootballMetric;
      dataFamily: "fixture_score";
      rawMetric: null;
      providers: readonly string[];
    }
  | {
      kind: "raw";
      metric: FootballMetric;
      dataFamily: "fixture_stats";
      rawMetric: ExecutableTeamRawMetric;
      providers: readonly string[];
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

const EXECUTABLE_RAW_TEAM_METRICS: Partial<Record<FootballMetric, ExecutableTeamRawMetric>> = {
  corners: "corners",
  shots: "shots",
  shots_on_target: "shots_on_target",
  cards: "cards",
};

export function resolveTeamMetricExecution(metric: FootballMetric): TeamMetricExecutionPlan {
  const definition = getFootballMetricDefinition(metric, "team");
  const providers = definition ? Object.keys(definition.providers) : [];

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
      providers,
    };
  }

  const rawMetric = EXECUTABLE_RAW_TEAM_METRICS[metric];
  if (rawMetric) {
    return {
      kind: "raw",
      metric,
      dataFamily: "fixture_stats",
      rawMetric,
      providers,
    };
  }

  const family = Object.values(definition.providers)[0]?.dataFamily ?? null;
  return {
    kind: "unsupported",
    metric,
    dataFamily: family,
    rawMetric: null,
    providers,
    reason: `A métrica ${metric} está no catálogo e possui mapeamento de provider, mas o adapter universal dessa família ainda não foi validado para execução determinística.`,
  };
}

export function isScoreDerivedTeamMetric(metric: FootballMetric): boolean {
  return SCORE_DERIVED_TEAM_METRICS.has(metric);
}
