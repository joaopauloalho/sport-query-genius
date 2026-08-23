import { AnalysisPipelineError } from "./errors";
import type { QueryIntentInput } from "./intent-schema";
import type { QueryPlan } from "./query-plan";
import { resolveFootballCapability } from "@/server/sports/capability-registry";

const TEAM_METRIC_TO_LEGACY = {
  goals_for: "goals",
  corners: "corners",
  shots: "shots",
  shots_on_target: "shots_on_target",
  cards: "cards",
} as const;

const PLAYER_METRIC_TO_LEGACY = {
  goals: "goals",
  shots: "shots",
  shots_on_target: "shots_on_target",
  cards: "cards",
} as const;

function legacyAggregation(plan: QueryPlan): "average" | "total" | "median" | "minimum" | "maximum" {
  const value = plan.aggregation;
  if (
    value === "average" ||
    value === "total" ||
    value === "median" ||
    value === "minimum" ||
    value === "maximum"
  ) {
    return value;
  }
  throw new AnalysisPipelineError(
    "UNSUPPORTED_CAPABILITY",
    `A agregação "${value ?? "não informada"}" foi entendida, mas ainda não está ligada ao engine desta fase.`,
  );
}

function lastMatches(plan: QueryPlan): 1 | 3 | 5 | 10 | 15 | 20 {
  const value = plan.scope.last_matches;
  if (value === 1 || value === 3 || value === 5 || value === 10 || value === 15 || value === 20) {
    return value;
  }
  throw new AnalysisPipelineError(
    "UNSUPPORTED_FILTER",
    "Esta capability executável exige uma janela de 1, 3, 5, 10, 15 ou 20 partidas.",
  );
}

export function queryPlanToLegacyIntent(plan: QueryPlan): QueryIntentInput {
  const capability = resolveFootballCapability(plan);
  if (!capability.supported) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      capability.reason ?? "A combinação pedida não está registrada no motor universal.",
    );
  }
  if (capability.stage !== "implemented") {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      `A pergunta foi entendida como ${plan.entity.type}/${plan.query_kind}${plan.metric ? `/${plan.metric}` : ""}${plan.event_type ? `/${plan.event_type}` : ""}, mas essa capability ainda está na fila de implementação determinística.`,
    );
  }

  const competition = plan.scope.competition ?? null;

  if (plan.query_kind === "event_list") {
    if (plan.entity.type !== "player" || plan.event_type !== "goal") {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        "Esta lista de eventos foi compreendida, mas ainda não possui executor determinístico nesta fase.",
      );
    }
    const eventCount = plan.scope.limit;
    if (!eventCount) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_FILTER",
        "Informe quantos eventos deseja listar, entre 1 e 20.",
      );
    }
    return {
      sport: "football",
      query_kind: "event_list",
      entity_type: "player",
      entity_name: plan.entity.name,
      metric: "goals",
      event_type: "goal",
      event_count: Math.min(20, eventCount),
      competition,
      venue: "all",
    };
  }

  if (plan.query_kind !== "aggregate" || !plan.metric) {
    throw new AnalysisPipelineError(
      "UNSUPPORTED_CAPABILITY",
      "O QueryPlan foi validado, mas ainda não existe adapter para este tipo de execução.",
    );
  }

  if (plan.entity.type === "team") {
    const metric = TEAM_METRIC_TO_LEGACY[plan.metric as keyof typeof TEAM_METRIC_TO_LEGACY];
    if (!metric) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        `A métrica "${plan.metric}" está catalogada para time, mas ainda não foi conectada ao provider executor.`,
      );
    }
    return {
      sport: "football",
      query_kind: "aggregate",
      entity_type: "team",
      entity_name: plan.entity.name,
      metric,
      aggregation: legacyAggregation(plan),
      match_count: lastMatches(plan),
      competition,
      venue: plan.scope.venue,
    };
  }

  if (plan.entity.type === "player") {
    const metric = PLAYER_METRIC_TO_LEGACY[plan.metric as keyof typeof PLAYER_METRIC_TO_LEGACY];
    if (!metric) {
      throw new AnalysisPipelineError(
        "UNSUPPORTED_CAPABILITY",
        `A métrica "${plan.metric}" está catalogada para jogador, mas ainda não foi conectada ao executor.`,
      );
    }
    return {
      sport: "football",
      query_kind: "aggregate",
      entity_type: "player",
      entity_name: plan.entity.name,
      metric,
      aggregation: legacyAggregation(plan),
      match_count: lastMatches(plan),
      competition,
      venue: "all",
    };
  }

  throw new AnalysisPipelineError(
    "UNSUPPORTED_CAPABILITY",
    `Aggregate para ${plan.entity.type} ainda não possui executor determinístico.`,
  );
}
