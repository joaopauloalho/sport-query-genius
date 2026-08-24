import type { AnalysisErrorCode } from "../analysis/errors";
import {
  FOOTBALL_FILTER_FIELDS,
  FOOTBALL_GROUP_BY_FIELDS,
  FOOTBALL_SORT_FIELDS,
  queryPlanSchema,
  type QueryPlan,
} from "../analysis/query-plan";
import type { SemanticPlan, SemanticQuery } from "../analysis/semantic-plan";
import { seasonTruthStatus } from "./competition-season-registry";
import { resolveFootballCapability, type CapabilityResolution } from "./capability-registry";
import { FOOTBALL_METRIC_KEYS, type FootballMetric } from "./metric-catalog";
import { resolveTeamMetricExecution } from "./team-query-capability";

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

const TEAM_FILTERS = new Set<string>(FOOTBALL_FILTER_FIELDS);
const GROUPS = new Set<string>(FOOTBALL_GROUP_BY_FIELDS);
const SORTS = new Set<string>(FOOTBALL_SORT_FIELDS);
const METRICS = new Set<string>(FOOTBALL_METRIC_KEYS);
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

function unsupportedSemanticField(
  query: SemanticQuery,
): { code: AnalysisErrorCode; reason: string } | null {
  for (const filter of query.filters) {
    if (!TEAM_FILTERS.has(filter.field)) {
      const recognizedMetric = METRICS.has(filter.field);
      return {
        code: "UNSUPPORTED_FILTER",
        reason: recognizedMetric
          ? `O filtro ${filter.field} ${filter.operator} foi compreendido, mas essa métrica ainda não possui executor determinístico de filtro por partida.`
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
  if (
    query.sort &&
    (!SORTS.has(query.sort.field) || !["asc", "desc"].includes(query.sort.direction))
  ) {
    return {
      code: "UNSUPPORTED_CAPABILITY",
      reason: `A ordenação ${query.sort.field}/${query.sort.direction} foi compreendida, mas ainda não é executável.`,
    };
  }
  return null;
}

function scopeLossRisk(query: SemanticQuery): string | null {
  if (query.scope.season) return null; // handled by CompetitionSeason truth gate.
  if (query.entity.type === "player") {
    if (
      query.scope.date_from ||
      query.scope.date_to ||
      query.scope.opponent ||
      query.scope.status
    ) {
      return "O adapter atual de jogador não executa date range, opponent ou status; o filtro foi preservado e a consulta foi recusada.";
    }
    if (query.scope.half !== "full") {
      return "O adapter atual de jogador não executa filtro por tempo de jogo.";
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
  const capability = resolveFootballCapability(queryPlan);
  add(checks, "registered_capability", capability.supported, capability.reason);
  if (!capability.supported) {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      capability.reason ?? "Capability não registrada.",
      capability,
    );
  }

  let executor: string | null = null;
  if (queryPlan.entity.type === "team" && queryPlan.query_kind === "aggregate") {
    if (!queryPlan.metric)
      return failure(checks, "UNSUPPORTED_METRIC", "Agregado sem métrica.", capability);
    const metricPlan = resolveTeamMetricExecution(queryPlan.metric);
    add(
      checks,
      "deterministic_metric_executor",
      metricPlan.kind !== "unsupported",
      metricPlan.kind === "unsupported" ? metricPlan.reason : null,
    );
    if (metricPlan.kind === "unsupported")
      return failure(checks, "UNSUPPORTED_CAPABILITY", metricPlan.reason, capability);
    if (
      ["percentage", "rate"].includes(queryPlan.aggregation ?? "") &&
      !RATIO_TEAM_METRICS.has(queryPlan.metric)
    ) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        `${queryPlan.aggregation} exige denominador semântico explícito e ${queryPlan.metric} ainda não o define.`,
        capability,
      );
    }
    executor = "team_universal_aggregate";
  } else if (queryPlan.entity.type === "team" && queryPlan.query_kind === "match_list") {
    executor = "team_universal_match_list";
  } else if (
    queryPlan.entity.type === "team" &&
    ["event_list", "schedule", "head_to_head"].includes(queryPlan.query_kind)
  ) {
    if (
      queryPlan.filters.length ||
      queryPlan.group_by.length ||
      queryPlan.sort ||
      queryPlan.limit
    ) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        `Filtros/group_by/sort/limit foram compreendidos, mas ${queryPlan.query_kind} ainda não executa essas operações.`,
        capability,
      );
    }
    if (capability.stage !== "implemented") {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        capability.reason ?? "Executor ainda não implementado.",
        capability,
      );
    }
    executor = `team_universal_${queryPlan.query_kind}`;
  } else if (
    queryPlan.entity.type === "player" &&
    ["aggregate", "event_list"].includes(queryPlan.query_kind)
  ) {
    if (
      queryPlan.filters.length ||
      queryPlan.group_by.length ||
      queryPlan.sort ||
      queryPlan.limit
    ) {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        "O adapter de jogador ainda não executa filtros/group_by/sort/limit de apresentação.",
        capability,
      );
    }
    if (capability.stage !== "implemented") {
      return failure(
        checks,
        "UNSUPPORTED_CAPABILITY",
        capability.reason ?? "Executor de jogador ainda não implementado.",
        capability,
      );
    }
    executor = `player_${queryPlan.query_kind}`;
  } else {
    return failure(
      checks,
      "UNSUPPORTED_CAPABILITY",
      capability.reason ??
        `Não existe executor determinístico ativo para ${queryPlan.entity.type}/${queryPlan.query_kind}.`,
      capability,
    );
  }

  add(checks, "deterministic_executor", true);
  const providers = Array.from(new Set(capability.sources.map((source) => source.provider)));
  const families = Array.from(new Set(capability.sources.map((source) => source.dataFamily)));
  add(
    checks,
    "provider_registered",
    providers.length > 0,
    providers.length ? null : "Nenhum provider registrado.",
  );
  if (!providers.length) {
    return failure(
      checks,
      "PROVIDER_UNAVAILABLE",
      "Nenhum provider registrado para a capability.",
      capability,
    );
  }

  return {
    supported: true,
    error_code: null,
    reason: null,
    checks,
    query_plan: queryPlan,
    capability,
    providers,
    data_families: families,
    executor,
    coverage: capability.sources.some((source) => source.conditionalCoverage)
      ? "runtime"
      : "not_required",
  };
}
