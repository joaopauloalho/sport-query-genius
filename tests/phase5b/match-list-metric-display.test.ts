import { describe, expect, test } from "bun:test";

import { formatMatchMetric } from "../../src/lib/match-metric-display";

describe("Phase 5B match_list metric display", () => {
  test("renders the requested count metric with a human label", () => {
    expect(
      formatMatchMetric({ key: "shots_on_target", value: 4, unit: "count", observed: true }),
    ).toBe("Finalizações no alvo: 4");
  });

  test("renders percentage metrics with the correct unit", () => {
    expect(
      formatMatchMetric({ key: "possession", value: 54.6, unit: "percentage", observed: true }),
    ).toBe("Posse de bola: 54,6 %");
  });

  test("preserves explicit zero instead of hiding it as UNKNOWN", () => {
    expect(formatMatchMetric({ key: "corners", value: 0, unit: "count", observed: true })).toBe(
      "Escanteios: 0",
    );
  });

  test("does not invent a display value when no observed metric exists", () => {
    expect(formatMatchMetric(null)).toBeNull();
    expect(formatMatchMetric(undefined)).toBeNull();
  });

  test("fails visibly to a humanized key rather than silently dropping an unknown label", () => {
    expect(
      formatMatchMetric({ key: "custom_metric", value: 1.25, unit: "count", observed: true }),
    ).toBe("Custom metric: 1,25");
  });
});
