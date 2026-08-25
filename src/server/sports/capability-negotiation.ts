import type { SemanticPlan } from "../analysis/semantic-plan";
import { metricIsSupportedForEntity, type FootballMetric } from "./metric-catalog";
import {
  negotiateFootballCapability as negotiateFootballCapabilityCore,
  type CapabilityNegotiation,
} from "./capability-negotiation-core";

export * from "./capability-negotiation-core";

/**
 * Public Phase 5C truth guard. The Phase 5C player capability extension must never bypass
 * entity-aware metric validation performed by the historical registry. Keep this guard outside
 * the extension core so every caller (ExecutionPlan, tests and benchmarks) observes the same rule.
 */
export function negotiateFootballCapability(semantic: SemanticPlan): CapabilityNegotiation {
  const entityType = semantic.query.entity.type;
  const metric = semantic.query.metric;
  if (
    metric &&
    (entityType === "team" || entityType === "player") &&
    !metricIsSupportedForEntity(metric as FootballMetric, entityType)
  ) {
    return {
      supported: false,
      error_code: "UNSUPPORTED_METRIC",
      reason: `A métrica ${metric} foi compreendida, mas não é catalogada para ${entityType}.`,
      checks: [
        {
          name: "entity_metric_compatibility",
          ok: false,
          reason: `${metric} is not catalogued for ${entityType}`,
        },
      ],
      query_plan: null,
      capability: null,
      providers: [],
      data_families: [],
      executor: null,
      coverage: "runtime",
    };
  }

  return negotiateFootballCapabilityCore(semantic);
}
