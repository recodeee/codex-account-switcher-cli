export function resolveFallbackDailyUsageWeights(
  activityCounts: number[],
  sessionCount: number,
): number[] {
  const windowDays = activityCounts.length;
  if (windowDays === 0) {
    return [];
  }

  const denominator = Math.max(windowDays - 1, 1);
  const activityDrivenWeights = activityCounts.map((count, index) => {
    if (count <= 0) {
      return 0;
    }
    const recencyBoost = 1 + index / denominator;
    return count * recencyBoost;
  });

  if (activityDrivenWeights.some((weight) => weight > 0)) {
    return activityDrivenWeights;
  }

  const syntheticWindow = Math.max(7, Math.min(windowDays, 14));
  const startIndex = Math.max(windowDays - syntheticWindow, 0);
  const weights = new Array<number>(windowDays).fill(0);
  const sessionBoost = Math.max(1, sessionCount);

  for (let index = startIndex; index < windowDays; index += 1) {
    const relativeIndex = index - startIndex;
    const recencyBoost = 0.65 + relativeIndex / Math.max(syntheticWindow, 1);
    const waveA = Math.sin((relativeIndex + 1) * 1.7);
    const waveB = Math.cos(
      (relativeIndex + 1) * 0.9 + sessionBoost * 0.35,
    );
    const spikeFactor = Math.max(0.2, waveA + waveB + 1.8);
    weights[index] = recencyBoost * spikeFactor;
  }

  if (!weights.some((weight) => weight > 0)) {
    weights[weights.length - 1] = 1;
  }

  return weights;
}
