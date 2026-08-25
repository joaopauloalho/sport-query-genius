import { describe, expect, test } from "bun:test";

import { runPhase5cGeniusBenchmark } from "./phase5c-benchmark";

describe("Phase 5C player truth gate", () => {
  test("player corpus has 216 deterministic cases with zero silent semantic loss", () => {
    const report = runPhase5cGeniusBenchmark();
    expect(report.total).toBe(216);
    expect(report.semantic_accuracy).toBe(100);
    expect(report.capability_accuracy).toBe(100);
    expect(report.unsupported_rejection_accuracy).toBe(100);
    expect(report.silent_semantic_loss).toBe(0);
    expect(report.passed).toBe(true);
  });
});
