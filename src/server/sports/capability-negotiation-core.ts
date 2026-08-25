import type { AnalysisErrorCode } from "../analysis/errors";
import {
  FOOTBALL_GROUP_BY_FIELDS,
  FOOTBALL_SORT_FIELDS,
  queryPlanSchema,
  type QueryPlan,
} from "../analysis/query-plan";
import type { SemanticPlan, SemanticQuery } from "../analysis/semantic-plan";
import { seasonTruthStatus } from "./competition-season-registry";
import {
  resolveFootballCapability,
  type CapabilityResolution,
  type FootballCapabilityDefinition,
} from "./capability-registry";
import {
  FOOTBALL_METRIC_KEYS,
  PLAYER_METRIC_KEYS,
  TEAM_METRIC_KEYS,
  metricIsSupportedForEntity,
  type FootballMetric,
  type PlayerMetricKey,
  type TeamMetric,
} from "./metric-catalog";
import {
  providersForPlayerMetrics,
  resolvePlayerMetricExecution,
  type PlayerMetricExecutionPlan,
} from "./player-query-capability";
import {
  providersForTeamMetrics,
  resolveTeamMetricExecution,
  type TeamMetricExecutionPlan,
} from "./team-query-capability";

export interface CapabilityCheck {
  name: string;
  ok: boolean;
  reason: string | null;
}

export interface CapabilityNegotiation {
  supported: boolean;
  error_code: AnalysisErrorCode | null;
  reason: string | null;
  checks: CapabilityCheck[];
  query_plan: QueryPlan | null;
  capability: CapabilityResolution | null;
  providers: readonly string[];
  data_families: readonly string[];
  executor: string | null;
  coverage: "runtime" | "not_required";
}

const GROUPS = new Set<string>(FOOTBALL_GROUP_BY_FIELDS);
const SORTS = new Set<string>(FOOTBALL_SORT_FIELDS);
const METRICS = new Set<string>(FOOTBALL_METRIC_KEYS);
const TEAM_METRICS = new Set<string>(TEAM_METRIC_KEYS);
const PLAYER_METRICS = new Set<string>(PLAYER_METRIC_KEYS);
const TEAM_STRUCTURAL_FILTERS = new Set(["outcome", "clean_sheet", "venue", "competition", "opponent"]);
const PLAYER_STRUCTURAL_FILTERS = new Set(["outcome", "venue", "competition", "opponent"]);
const RATIO_TEAM_METRICS = new Set<FootballMetric>([
  "wins",
  "draws",
  "losses",
  "win_rate",
  "unbeaten_rate",
  "clean_sheets",
  "failed_to_score",
  "both_teams_scored",
  "points",
]);
const PLAYER_SUPPORTED_AGGREGATIONS = new Set([
  "average",
  "total",
  "median",
  "minimum",
  "maximum",
  "count",
]);

function failure(
  checks: CapabilityCheck[],
  code: AnalysisErrorCode,
  reason: string,
  capability: CapabilityResolution | null = null,
): CapabilityNegotiation {
  return {
    supported: false,
    error_code: code,
    reason,
    checks,
    query_plan: null,
    capability,
    providers: capability?.sources.map((source) => source.provider) ?? [],
    data_families: capability?.sources.map((source) => source.dataFamily) ?? [],
    executor: null,
    coverage: "runtime",
  };
}

function add(checks: CapabilityCheck[], name: string, ok: boolean, reason: string | null = null) {
  checks.push({ name, ok, reason: ok ? null : reason });
}

function entityAllowsMetric(entity: SemanticQuery["entity"]["type"], metric: string): boolean {
  if (!METRICS.has(metric)) return false;
  if (entity === "team") return metricIsSupportedForEntity(metric as FootballMetric, "team");
  if (entity === "player") return metricIsSupportedForEntity(metric as FootballMetric, "player");
  return false;
}

function filterAllowed(query: SemanticQuery, field: string): boolean {
  if (query.entity.type === "team") {
    return TEAM_STRUCTURAL_FILTERS.has(field) || entityAllowsMetric("team", field);
  }
  if (query.entity.type === "player") {
    return PLAYER_STRUCTURAL_FILTERS.has(field) || entityAllowsMetric("player", field);
  }
  return false;
}

function unsupportedSemanticField(
  query: SemanticQuery,
): { code: AnalysisErrorCode; reason: string } | null {
  for (const filter of query.filters) {
    if (!filterAllowed(query, filter.field)) {
      const recognizedMetric = METRICS.has(filter.field);
      return {
        code: "UNSUPPORTED_FILTER",
        reason: recognizedMetric
          ? `O filtro ${filter.field} ${filter.operator} foi compreendido, mas ${filter.field} não é executável para ${query.entity.type}.`
          : `O filtro "${filter.field}" foi preservado pelo SemanticPlan, mas ainda não é uma capability executável.`,
      };
    }
  }
  for (const group of query.group_by) {
    if (!GROUPS.has(group)) {
      return {
        code: "UNSUPPORTED_CAPABILITY",
        reason: `O group_by "${group}" foi preservado pelo SemanticPlan, mas ainda não é executável.`,
      };
    }
  }
  if (query.sort && (!SORTS.has(query.sort.field) || !["asc", "desc"].includes(query.sort.direction))) {
    return {
      code: "UNSUPPORTED_CAPABILITY",
      reason: `A ordenação ${query.sort.field}/${query.sort.direction} foi compreendida, mas ainda não é executável.`,
    };
  }
  return null;
}

function scopeLossRisk(query: SemanticQuery): string | null {
  if (query.entity.type === "player") {
    if (query.scope.half !== "full") {
      return "Estatísticas de jogador por primeiro/segundo tempo não foram comprovadas; half foi preservado e recusado.";
    }
    if (query.scope.status && query.scope.status !== "finished") {
      return "O executor de jogador exige partidas finalizadas; live/upcoming sem player_match_stats não será aceito silenciosamente.";
    }
  }
  if (query.entity.type === "team" && ["aggregate", "match_list"].includes(query.query_kind)) {
    if (query.scope.half !== "full")
      return "O executor universal de agregados/listas de time ainda não calcula métricas por primeiro/segundo tempo.";
    if (query.scope.status && query.scope.status !== "finished") {
      return "O executor universal de agregados/listas de time executa somente partidas finalizadas.";
    }
  }
  return null;
}

function normalizedProvider(value: string): string {
  return value === "API_FOOTBALL" ? "API-FOOTBALL" : value;
}

function teamMetricPlans(queryPlan: QueryPlan): TeamMetricExecutionPlan[] {
  if (queryPlan.entity.type !== "team") return [];
  const metrics = new Set<TeamMetric>();
  if (queryPlan.metric && TEAM_METRICS.has(queryPlan.metric)) metrics.add(queryPlan.metric as TeamMetric);
  for (const filter of queryPlan.filters) {
    if (TEAM_METRICS.has(filter.field)) metrics.add(filter.field as TeamMetric);
  }
  return [...metrics].map(resolveTeamMetricExecution);
}

function playerMetricPlans(queryPlan: QueryPlan): PlayerMetricExecutionPlan[] {
  if (queryPlan.entity.type !== "player") return [];
  const metrics = new Set<PlayerMetricKey>();
  if (queryPlan.metric && PLAYER_METRICS.has(queryPlan.metric)) metrics.add(queryPlan.metric as PlayerMetricKey);
  for (const filter of queryPlan.filters) {
    if (PLAYER_METRICS.has(filter.field)) metrics.add(filter.field as PlayerMetricKey);
  }
  return [...metrics].map(resolvePlayerMetricExecution);
}

function phase5cPlayerCapability(plan: QueryPlan): CapabilityResolution {
  const definition: FootballCapabilityDefinition = {
    entityType: "player",
    queryKind: plan.query_kind,
    stage: "implemented",
    cacheFamily: plan.query_kind === "event_list" ? "incidents_finished" : "player_stats",
    sources:
      plan.query_kind === "event_list"
        ? [
            {
              provider: "BSD",
              endpoint: "/events/{event_id}/stats/ shotmap",
              dataFamily: "shotmap",
              fallback: false,
              conditionalCoverage: true,
            },
          ]
        : [
            {
              provider: "BSD",
              endpoint: "/players/{player_id}/stats/ + /events/",
              dataFamily: "player_match_stats",
              fallback: false,
              conditionalCoverage: true,
            },
            {
              provider: "API_FOOTBALL",
              endpoint: "/fixtures/players",
              dataFamily: "player_match_stats",
              fallback: true,
              conditionalCoverage: true,
            },
          ],
    ...(plan.query_kind === "event_list" ? { events: ["goal"] as const } : {}),
    note:
      plan.query_kind === "event_list"
        ? "Phase 3D goal event list retained for regression compatibility."
        : "Phase 5C normalized player-match snapshots; API-Football adapter remains runtime-gated until conservative cross-provider identity is proven.",
  };
  return {
    supported: true,
    stage: "implemented",
    capability: definition,
    sources: definition.sources,
    reason: null,
  };
}

export function negotiateFootballCapability(semantic: SemanticPlan): CapabilityNegotiation {
  const checks: CapabilityCheck[] = [];
  if (semantic.preservation_issues.length > 0) {
    const first = semantic.preservation_issues[0];
    add(checks, "semantic_preservation", false, first.path);
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      `O campo semântico "${first.field}" em ${first.path} não é reconhecido e não será descartado silenciosamente.`,
    );
  }
  add(checks, "semantic_preservation", true);

  const semanticFieldFailure = unsupportedSemanticField(semantic.query);
  if (semanticFieldFailure) {
    add(checks, "semantic_fields", false, semanticFieldFailure.reason);
    return failure(checks, semanticFieldFailure.code, semanticFieldFailure.reason);
  }
  add(checks, "semantic_fields", true);

  const season = seasonTruthStatus(semantic.query);
  add(checks, "competition_season", season.executable, season.reason);
  if (!season.executable) return failure(checks, "UNSUPPORTED_FILTER", season.reason);

  const lossRisk = scopeLossRisk(semantic.query);
  add(checks, "scope_execution", lossRisk === null, lossRisk);
  if (lossRisk) return failure(checks, "UNSUPPORTED_FILTER", lossRisk);

  const parsed = queryPlanSchema.safeParse(semantic.query);
  add(
    checks,
    "execution_schema",
    parsed.success,
    parsed.success ? null : "SemanticPlan is not representable by the strict ExecutionPlan schema.",
  );
  if (!parsed.success) {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      "A intenção foi preservada, mas ainda não pode ser convertida integralmente para o ExecutionPlan.",
    );
  }
  const queryPlan = parsed.data;
  const capability =
    queryPlan.entity.type === "player" && ["aggregate", "match_list", "event_list"].includes(queryPlan.query_kind)
      ? phase5cPlayerCapability(queryPlan)
      : resolveFootballCapability(queryPlan);
  add(checks, "registered_capability", capability.supported, capability.reason);
  if (!capability.supported) {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      capability.reason ?? "Capability não registrada.",
      capability,
    );
  }

  if (queryPlan.entity.type === "player") {
    if (queryPlan.query_kind === "event_list") {
      if (queryPlan.event_type !== "goal") {
        return failure(
          checks,
          "UNSUPPORTED_CAPABILITY",
          "Phase 5C preserva event_list de gol; assist/card timeline continua gated sem evento individual comprovado.",
          capability,
        );
      }
      if (queryPlan.filters.length || queryPlan.group_by.length || queryPlan.sort || queryPlan.limit) {
        return failure(
          checks,
          "UNSUPPORTED_CAPABILITY",
          "Filtros/group/sort/limit em player event_list ainda não possuem timeline executor comprovado.",
          capability,
        );
      }
      return {
        supported: true,
        error_code: null,
        reason: null,
        checks: [...checks, { name: "deterministic_executor", ok: true, reason: null }],
        query_plan: queryPlan,
        capability,
        providers: ["BSD"],
        data_families: ["fixtures", "shotmap"],
        executor: "player_event_list",
        coverage: "runtime",
      };
    }

    if (!["aggregate", "match_list"].includes(queryPlan.query_kind)) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        `Phase 5C não implementa ${queryPlan.query_kind} populacional/comparativo de jogador.`,
        capability,
      );
    }

    if (queryPlan.query_kind === "aggregate" && !PLAYER_SUPPORTED_AGGREGATIONS.has(queryPlan.aggregation ?? "")) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        `${queryPlan.aggregation} para player exige semântica de denominador não definida nesta fase.`,
        capability,
      );
    }

    const plans = playerMetricPlans(queryPlan);
    for (const plan of plans) {
      add(
        checks,
        `player_metric_executor:${plan.metric}`,
        plan.kind !== "unsupported",
        plan.kind === "unsupported" ? plan.reason : null,
      );
      if (plan.kind === "unsupported") {
        return failure(
          checks,
          queryPlan.metric === plan.metric ? "UNSUPPORTED_METRIC" : "UNSUPPORTED_FILTER",
          plan.reason,
          capability,
        );
      }
    }

    const requiredMetrics = plans.map((plan) => plan.metric as FootballMetric);
    const compatibleProviders = providersForPlayerMetrics(requiredMetrics);
    if (plans.length > 0 && compatibleProviders.length === 0) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        "Nenhum provider único consegue fornecer output e filtros de jogador sem misturar namespaces/coverage.",
        capability,
      );
    }

    // BSD is the only runtime source with conservative player identity wired in Phase 5C.
    // API-Football /fixtures/players is normalized and cached, but cross-provider identity remains fail-closed.
    const runtimeProviders = compatibleProviders.filter((provider) => provider === "BSD");
    if (plans.length > 0 && runtimeProviders.length === 0) {
      return failure(
        checks,
        "PROVIDER_UNAVAILABLE",
        "A métrica só seria executável via API-FOOTBALL, mas a identidade cross-provider do jogador não foi comprovada; fallback recusado.",
        capability,
      );
    }

    const families = new Set<string>(["fixtures", "player_match_stats"]);
    if (queryPlan.scope.season) families.add("league_season");
    add(checks, "provider_compatibility_intersection", true);
    add(checks, "data_family_dedupe", true);
    add(checks, "deterministic_executor", true);
    return {
      supported: true,
      error_code: null,
      reason: null,
      checks,
      query_plan: queryPlan,
      capability,
      providers: plans.length > 0 ? runtimeProviders : ["BSD"],
      data_families: [...families],
      executor:
        queryPlan.query_kind === "aggregate"
          ? "player_universal_aggregate"
          : "player_universal_match_list",
      coverage: "runtime",
    };
  }

  const metricPlans = teamMetricPlans(queryPlan);
  for (const filter of queryPlan.filters) {
    if (!TEAM_METRICS.has(filter.field)) continue;
    const filterPlan = resolveTeamMetricExecution(filter.field as TeamMetric);
    add(
      checks,
      `filter_metric_executor:${filter.field}`,
      filterPlan.kind !== "unsupported",
      filterPlan.kind === "unsupported" ? filterPlan.reason : null,
    );
    if (filterPlan.kind === "unsupported") {
      return failure(
        checks,
        "UNSUPPORTED_FILTER",
        `O filtro ${filter.field} foi compreendido, mas não pode ser executado sem perda semântica: ${filterPlan.reason}`,
        capability,
      );
    }
  }

  const rawMetricPlans = metricPlans.filter(
    (plan): plan is Extract<TeamMetricExecutionPlan, { kind: "raw" }> => plan.kind === "raw",
  );
  const requiredRawMetrics = rawMetricPlans.map((plan) => plan.metric);
  const metricProviders = providersForTeamMetrics(requiredRawMetrics);
  if (rawMetricPlans.length > 0 && metricProviders.length === 0) {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      "As métricas solicitadas são executáveis isoladamente, mas nenhum provider consegue fornecer todas as famílias necessárias sem descartar filtros.",
      capability,
    );
  }

  let executor: string | null = null;
  if (queryPlan.entity.type === "team" && queryPlan.query_kind === "aggregate") {
    if (!queryPlan.metric) return failure(checks, "UNSUPPORTED_METRIC", "Agregado sem métrica.", capability);
    const metricPlan = resolveTeamMetricExecution(queryPlan.metric);
    add(checks, "deterministic_metric_executor", metricPlan.kind !== "unsupported", metricPlan.kind === "unsupported" ? metricPlan.reason : null);
    if (metricPlan.kind === "unsupported") return failure(checks, "UNSUPPORTED_CAPABILITY", metricPlan.reason, capability);
    if (["percentage", "rate"].includes(queryPlan.aggregation ?? "") && !RATIO_TEAM_METRICS.has(queryPlan.metric)) {
      return failure(checks, "UNSUPPORTED_CAPABILITY", `${queryPlan.aggregation} exige denominador semântico explícito e ${queryPlan.metric} ainda não o define.`, capability);
    }
    executor = "team_universal_aggregate";
  } else if (queryPlan.entity.type === "team" && queryPlan.query_kind === "match_list") {
    if (queryPlan.sort) {
      return failure(checks, "UNSUPPORTED_CAPABILITY", "sort em match_list foi compreendido, mas ainda não possui executor determinístico; a consulta foi recusada para evitar semantic loss.", capability);
    }
    if (queryPlan.metric) {
      const metricPlan = resolveTeamMetricExecution(queryPlan.metric);
      add(checks, "match_list_metric_output", metricPlan.kind !== "unsupported", metricPlan.kind === "unsupported" ? metricPlan.reason : null);
      if (metricPlan.kind === "unsupported") return failure(checks, "UNSUPPORTED_CAPABILITY", metricPlan.reason, capability);
    }
    executor = "team_universal_match_list";
  } else if (queryPlan.entity.type === "team" && ["event_list", "schedule", "head_to_head"].includes(queryPlan.query_kind)) {
    if (queryPlan.filters.length || queryPlan.group_by.length || queryPlan.sort || queryPlan.limit) {
      return failure(checks, "UNSUPPORTED_CAPABILITY", `Filtros/group_by/sort/limit foram compreendidos, mas ${queryPlan.query_kind} ainda não executa essas operações.`, capability);
    }
    if (capability.stage !== "implemented") return failure(checks, "UNSUPPORTED_CAPABILITY", capability.reason ?? "Executor ainda não implementado.", capability);
    executor = `team_universal_${queryPlan.query_kind}`;
  } else {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      capability.reason ?? `Não existe executor determinístico ativo para ${queryPlan.entity.type}/${queryPlan.query_kind}.`,
      capability,
    );
  }

  add(checks, "deterministic_executor", true);
  const capabilityProviders = Array.from(new Set(capability.sources.map((source) => normalizedProvider(source.provider))));
  const providers = rawMetricPlans.length > 0 ? metricProviders.filter((provider) => capabilityProviders.includes(provider)) : capabilityProviders;
  const families = new Set<string>(["fixtures"]);
  const structuralScoreFilters = queryPlan.filters.some((filter) => {
    if (["outcome", "clean_sheet"].includes(filter.field)) return true;
    if (!TEAM_METRICS.has(filter.field)) return false;
    return resolveTeamMetricExecution(filter.field as TeamMetric).kind === "derived";
  });
  if (metricPlans.some((plan) => plan.kind === "derived") || structuralScoreFilters) families.add("fixture_score");
  if (rawMetricPlans.length > 0) families.add("fixture_stats");
  if (queryPlan.scope.season) families.add("league_season");
  add(checks, "provider_registered", providers.length > 0, providers.length ? null : "Nenhum provider registrado para todas as métricas necessárias.");
  if (!providers.length) return failure(checks, "PROVIDER_UNAVAILABLE", "Nenhum provider registrado consegue executar integralmente a consulta.", capability);
  add(checks, "data_family_dedupe", true);

  return {
    supported: true,
    error_code: null,
    reason: null,
    checks,
    query_plan: queryPlan,
    capability,
    providers,
    data_families: [...families],
    executor,
    coverage:
      rawMetricPlans.some((plan) => plan.conditionalCoverage) ||
      capability.sources.some((source) => source.conditionalCoverage)
        ? "runtime"
        : "not_required",
  };
}
