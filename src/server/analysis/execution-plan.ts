import { AnalysisPipelineError } from "./errors";
import type { QueryPlan } from "./query-plan";
import type { SemanticPlan } from "./semantic-plan";
import {
  negotiateFootballCapability,
  type CapabilityNegotiation,
} from "../sports/capability-negotiation";

export interface ExecutionPlan {
  version: 1;
  semantic_plan: SemanticPlan;
  query_plan: QueryPlan;
  negotiation: CapabilityNegotiation;
  entity_resolution: "runtime_required";
  providers: readonly string[];
  data_families: readonly string[];
  fallback: boolean;
  coverage: "runtime" | "not_required";
  cache_family: string | null;
  deterministic_executor: string;
}

export function buildExecutionPlan(semantic: SemanticPlan): ExecutionPlan {
  const negotiation = negotiateFootballCapability(semantic);
  if (!negotiation.supported || !negotiation.query_plan || !negotiation.executor) {
    throw new AnalysisPipelineError(
      negotiation.error_code ?? "UNSUPPORTED_CAPABILITY",
      negotiation.reason ??
        "A pergunta foi compreendida, mas não existe ExecutionPlan integral e seguro.",
    );
  }

  return {
    version: 1,
    semantic_plan: semantic,
    query_plan: negotiation.query_plan,
    negotiation,
    entity_resolution: "runtime_required",
    providers: negotiation.providers,
    data_families: negotiation.data_families,
    fallback: negotiation.providers.length > 1,
    coverage: negotiation.coverage,
    cache_family: negotiation.capability?.capability?.cacheFamily ?? null,
    deterministic_executor: negotiation.executor,
  };
}
