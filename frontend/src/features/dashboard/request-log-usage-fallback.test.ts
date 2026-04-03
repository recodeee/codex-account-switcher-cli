import { describe, expect, it } from "vitest";

import { mergeRequestLogUsageSummaryWithLiveFallback } from "@/features/dashboard/request-log-usage-fallback";
import type { DashboardOverview, RequestLogUsageSummary } from "@/features/dashboard/schemas";

function createWindows(
  primaryConsumed: number,
  secondaryConsumed: number,
): DashboardOverview["windows"] {
  return {
    primary: {
      windowKey: "primary",
      windowMinutes: 300,
      accounts: [
        {
          accountId: "acc-1",
          remainingPercentAvg: 50,
          capacityCredits: primaryConsumed + 100,
          remainingCredits: 100,
        },
      ],
    },
    secondary: {
      windowKey: "secondary",
      windowMinutes: 10_080,
      accounts: [
        {
          accountId: "acc-1",
          remainingPercentAvg: 50,
          capacityCredits: secondaryConsumed + 250,
          remainingCredits: 250,
        },
      ],
    },
  };
}

function createRequestSummary(
  last5hTotal: number,
  last7dTotal: number,
): RequestLogUsageSummary {
  return {
    last5h: {
      totalTokens: last5hTotal,
      totalCostUsd: 1,
      totalCostEur: 0.92,
      accounts: [{ accountId: "acc-1", tokens: last5hTotal, costUsd: 1, costEur: 0.92 }],
    },
    last7d: {
      totalTokens: last7dTotal,
      totalCostUsd: 2,
      totalCostEur: 1.84,
      accounts: [{ accountId: "acc-1", tokens: last7dTotal, costUsd: 2, costEur: 1.84 }],
    },
    fxRateUsdToEur: 0.92,
  };
}

describe("mergeRequestLogUsageSummaryWithLiveFallback", () => {
  it("keeps request-log totals when request summary windows are non-zero", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummary(320, 1800),
      createWindows(999, 4444),
    );

    expect(merged.usageSummary.last5h.totalTokens).toBe(320);
    expect(merged.usageSummary.last7d.totalTokens).toBe(1800);
    expect(merged.usageSummary.fxRateUsdToEur).toBe(0.92);
    expect(merged.fallback).toEqual({
      last5h: false,
      last7d: false,
      active: false,
    });
  });

  it("falls back to live windows when request totals are zero", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummary(0, 0),
      createWindows(640, 3200),
    );

    expect(merged.usageSummary.last5h.totalTokens).toBe(640);
    expect(merged.usageSummary.last7d.totalTokens).toBe(3200);
    expect(merged.usageSummary.last5h.totalCostEur).toBe(0);
    expect(merged.usageSummary.last7d.totalCostEur).toBe(0);
    expect(merged.usageSummary.fxRateUsdToEur).toBe(0.92);
    expect(merged.fallback).toEqual({
      last5h: true,
      last7d: true,
      active: true,
    });
  });

  it("applies fallback independently per window", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummary(420, 0),
      createWindows(700, 9000),
    );

    expect(merged.usageSummary.last5h.totalTokens).toBe(420);
    expect(merged.usageSummary.last7d.totalTokens).toBe(9000);
    expect(merged.usageSummary.last7d.totalCostEur).toBeCloseTo(19.7142857143, 6);
    expect(merged.usageSummary.fxRateUsdToEur).toBe(0.92);
    expect(merged.fallback).toEqual({
      last5h: false,
      last7d: true,
      active: true,
    });
  });
});
