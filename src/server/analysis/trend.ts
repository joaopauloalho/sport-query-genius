export function calculateDeterministicTrend(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length < 2) return 0;
  const n = finite.length;
  const meanX = (n - 1) / 2;
  const meanY = finite.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = index - meanX;
    numerator += dx * (finite[index] - meanY);
    denominator += dx * dx;
  }
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 100) / 100;
}
