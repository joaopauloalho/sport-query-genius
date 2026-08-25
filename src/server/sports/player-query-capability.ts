import {
  getFootballMetricDefinition,
  metricIsSupportedForEntity,
  type FootballMetric,
  type PlayerMetricKey,
} from "./metric-catalog";

export type PlayerMetricExecutionPlan =
  | {
      kind: "raw";
      metric: PlayerMetricKey;
      dataFamily: "player_match_stats";
      providers: readonly ("BSD" | "API-FOOTBALL")[];
      conditionalCoverage: boolean;
      components: readonly [];
    }
  | {
      kind: "derived";
      metric: PlayerMetricKey;
      dataFamily: "player_match_stats";
      providers: readonly ("BSD" | "API-FOOTBALL")[];
      conditionalCoverage: boolean;
      components: readonly PlayerMetricKey[];
    }
  | {
      kind: "unsupported";
      metric: FootballMetric;
      dataFamily: string | null;
      providers: readonly string[];
      conditionalCoverage: true;
      components: readonly PlayerMetricKey[];
      reason: string;
    };

const DERIVED_COMPONENTS: Partial<Record<PlayerMetricKey, readonly PlayerMetricKey[]>> = {
  goal_contributions: ["goals", "assists"],
  cards: ["yellow_cards", "red_cards"],
};

function providerName(provider: string): "BSD" | "API-FOOTBALL" {
  return provider === "API_FOOTBALL" ? "API-FOOTBALL" : "BSD";
}

function directProviders(metric: PlayerMetricKey): ("BSD" | "API-FOOTBALL")[] {
  const definition = getFootballMetricDefinition(metric, "player");
  if (!definition) return [];
  return Object.entries(definition.providers)
    .filter(([, mapping]) => mapping?.dataFamily === "player_match_stats")
    .map(([provider]) => providerName(provider));
}

function intersection(sets: readonly (readonly ("BSD" | "API-FOOTBALL")[])[]) {
  if (sets.length === 0) return [] as ("BSD" | "API-FOOTBALL")[];
  return sets
    .slice(1)
    .reduce(
      (providers, current) => providers.filter((provider) => current.includes(provider)),
      [...sets[0]],
    );
}

export function resolvePlayerMetricExecution(metric: FootballMetric): PlayerMetricExecutionPlan {
  if (!metricIsSupportedForEntity(metric, "player")) {
    return {
      kind: "unsupported",
      metric,
      dataFamily: null,
      providers: [],
      conditionalCoverage: true,
      components: [],
      reason: `A métrica ${metric} não está catalogada para jogador.`,
    };
  }

  const playerMetric = metric as PlayerMetricKey;
  const components = DERIVED_COMPONENTS[playerMetric];
  if (components) {
    const providers = intersection(components.map(directProviders));
    if (providers.length === 0) {
      return {
        kind: "unsupported",
        metric,
        dataFamily: "player_match_stats",
        providers: [],
        conditionalCoverage: true,
        components: [...components],
        reason: `A métrica derivada ${metric} não possui um provider único com todos os componentes observáveis.`,
      };
    }
    return {
      kind: "derived",
      metric: playerMetric,
      dataFamily: "player_match_stats",
      providers,
      conditionalCoverage: true,
      components: [...components],
    };
  }

  const definition = getFootballMetricDefinition(playerMetric, "player");
  const providers = directProviders(playerMetric);
  if (!definition || providers.length === 0) {
    return {
      kind: "unsupported",
      metric,
      dataFamily: definition
        ? (Object.values(definition.providers)[0]?.dataFamily ?? null)
        : null,
      providers,
      conditionalCoverage: true,
      components: [],
      reason: `A métrica ${metric} está catalogada, mas não possui mapping player_match_stats executável.`,
    };
  }

  return {
    kind: "raw",
    metric: playerMetric,
    dataFamily: "player_match_stats",
    providers,
    conditionalCoverage: Object.values(definition.providers).some(
      (mapping) => mapping?.coverage === "conditional",
    ),
    components: [],
  };
}

export function providersForPlayerMetrics(metrics: readonly FootballMetric[]): ("BSD" | "API-FOOTBALL")[] {
  const plans = metrics.map(resolvePlayerMetricExecution);
  if (plans.some((plan) => plan.kind === "unsupported")) return [];
  return intersection(plans.map((plan) => plan.providers as readonly ("BSD" | "API-FOOTBALL")[]));
}

export function playerMetricDependencies(metric: FootballMetric): PlayerMetricKey[] {
  const plan = resolvePlayerMetricExecution(metric);
  if (plan.kind === "unsupported") return [];
  return plan.kind === "derived" ? [...plan.components] : [plan.metric];
}
