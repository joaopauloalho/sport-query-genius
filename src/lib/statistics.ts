export interface DeterministicStatistics {
  average: number;
  median: number;
  total: number;
  maximum: number;
  minimum: number;
  sample_size: number;
}

const round = (value: number) => Math.round(value * 10) / 10;

export function calculateStatistics(values: number[]): DeterministicStatistics {
  if (values.length === 0) {
    throw new Error("calculateStatistics requires at least one value");
  }

  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("calculateStatistics received a non-finite value");
  }

  const ordered = [...values].sort((a, b) => a - b);
  const total = values.reduce((sum, value) => sum + value, 0);
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 1 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;

  return {
    average: round(total / values.length),
    median: round(median),
    total: round(total),
    maximum: Math.max(...values),
    minimum: Math.min(...values),
    sample_size: values.length,
  };
}

export function calculateTrend(values: number[], recentCount = 5): number {
  if (values.length === 0) return 0;

  const fullAverage = values.reduce((sum, value) => sum + value, 0) / values.length;
  const recent = values.slice(-Math.min(recentCount, values.length));
  const recentAverage = recent.reduce((sum, value) => sum + value, 0) / recent.length;

  return round(recentAverage - fullAverage);
}
