import { describe, expect, test } from "bun:test";

import {
  aggregateNumericValues,
  aggregateRatio,
} from "../../src/server/analysis/aggregation";

describe("Phase 4A deterministic aggregation", () => {
  test("calculates total, average, median, minimum and maximum from the same sample", () => {
    const values = [3, 7, 5, 11, 4];

    expect(aggregateNumericValues(values, "total").value).toBe(30);
    expect(aggregateNumericValues(values, "average").value).toBe(6);
    expect(aggregateNumericValues(values, "median").value).toBe(5);
    expect(aggregateNumericValues(values, "minimum").value).toBe(3);
    expect(aggregateNumericValues(values, "maximum").value).toBe(11);
    expect(aggregateNumericValues(values, "count").value).toBe(5);
  });

  test("never converts null to zero and refuses incomplete samples by default", () => {
    const result = aggregateNumericValues([4, null, 8, 6, 2], "average");

    expect(result.value).toBeNull();
    expect(result.coverage).toEqual({
      requested: 5,
      known: 4,
      missing: 1,
      complete: false,
    });
  });

  test("allows partial aggregation only when the caller opts in explicitly", () => {
    const result = aggregateNumericValues([4, null, 8, 6, 2], "average", {
      allowPartial: true,
    });

    expect(result.value).toBe(5);
    expect(result.coverage.complete).toBe(false);
    expect(result.coverage.known).toBe(4);
  });

  test("calculates percentage and rate without guessing a missing denominator", () => {
    expect(aggregateRatio(4, 5, "percentage").value).toBe(80);
    expect(aggregateRatio(4, 5, "rate").value).toBe(0.8);
    expect(aggregateRatio(4, null, "percentage").value).toBeNull();
    expect(aggregateRatio(4, 0, "percentage").value).toBeNull();
  });
});
