import { describe, expect, it } from "vitest";

import { resolveFallbackDailyUsageWeights } from "./runtime-daily-usage";

describe("resolveFallbackDailyUsageWeights", () => {
  it("keeps activity-driven weights and boosts newer active days", () => {
    const weights = resolveFallbackDailyUsageWeights([0, 1, 0, 2], 1);

    expect(weights).toEqual([0, 1 + 1 / 3, 0, 2 * (1 + 3 / 3)]);
  });

  it("creates synthetic non-flat weights when there is no activity", () => {
    const weights = resolveFallbackDailyUsageWeights(new Array(30).fill(0), 2);
    const positiveWeights = weights.filter((weight) => weight > 0);

    expect(positiveWeights.length).toBeGreaterThan(1);
    expect(new Set(positiveWeights.map((weight) => weight.toFixed(6))).size).toBeGreaterThan(1);
    expect(weights.slice(0, 10).every((weight) => weight === 0)).toBe(true);
  });

  it("returns an empty array for empty input", () => {
    expect(resolveFallbackDailyUsageWeights([], 1)).toEqual([]);
  });
});
