import type { FootballAggregation } from "./query-plan";

export interface AggregationCoverage {
  requested: number;
  known: number;
  missing: number;
  complete: boolean;
}

export interface NumericAggregationResult {
  aggregation: FootballAggregation;
  value: number | null;
  coverage: AggregationCoverage;
}

function median(values: readonly number[]): number {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function aggregateNumericValues(
  values: readonly (number | null)[],
  aggregation: Exclude<FootballAggregation, "percentage" | "rate">,
  options: { allowPartial?: boolean } = {},
): NumericAggregationResult {
  const known = values.filter((value): value is number => value !== null && Number.isFinite(value));
  const coverage: AggregationCoverage = {
    requested: values.length,
    known: known.length,
    missing: values.length - known.length,
    complete: known.length === values.length,
  };

  if (known.length === 0 || (!options.allowPartial && !coverage.complete)) {
    return { aggregation, value: null, coverage };
  }

  let value: number;
  if (aggregation === "total") value = known.reduce((sum, item) => sum + item, 0);
  else if (aggregation === "average")
    value = known.reduce((sum, item) => sum + item, 0) / known.length;
  else if (aggregation === "median") value = median(known);
  else if (aggregation === "minimum") value = Math.min(...known);
  else if (aggregation === "maximum") value = Math.max(...known);
  else value = known.length;

  return { aggregation, value: round(value), coverage };
}

export function aggregateRatio(
  numerator: number | null,
  denominator: number | null,
  aggregation: "percentage" | "rate",
): NumericAggregationResult {
  const numeratorKnown = numerator !== null && Number.isFinite(numerator);
  const denominatorKnown = denominator !== null && Number.isFinite(denominator);
  const coverage: AggregationCoverage = {
    requested: 2,
    known: Number(numeratorKnown) + Number(denominatorKnown),
    missing: Number(!numeratorKnown) + Number(!denominatorKnown),
    complete: numeratorKnown && denominatorKnown,
  };

  if (!coverage.complete || denominator === 0 || numerator === null || denominator === null) {
    return { aggregation, value: null, coverage };
  }

  const ratio = numerator / denominator;
  return {
    aggregation,
    value: round(aggregation === "percentage" ? ratio * 100 : ratio),
    coverage,
  };
}
