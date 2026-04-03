import { describe, expect, it } from "vitest";

import { mergeRequestLogUsageSummaryWithLiveFallback } from "@/features/dashboard/request-log-usage-fallback";
import type { DashboardOverview, RequestLogUsageSummary } from "@/features/dashboard/schemas";
import { createAccountSummary } from "@/test/mocks/factories";

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

function createRequestSummaryWithWindows(
  last5h: RequestLogUsageSummary["last5h"],
  last7d: RequestLogUsageSummary["last7d"],
): RequestLogUsageSummary {
  return {
    last5h,
    last7d,
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
    expect(merged.usageSummary.last5h.totalCostEur).toBeGreaterThan(0);
    expect(merged.usageSummary.last7d.totalCostEur).toBeGreaterThan(0);
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

  it("derives fallback EUR estimates from account request usage when request logs are empty", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummary(0, 0),
      createWindows(640, 3200),
      [
        createAccountSummary({
          accountId: "acc-1",
          requestUsage: {
            requestCount: 12,
            totalTokens: 10_000,
            cachedInputTokens: 0,
            totalCostUsd: 5,
          },
        }),
      ],
    );

    expect(merged.usageSummary.last5h.totalCostUsd).toBeCloseTo(0.32, 6);
    expect(merged.usageSummary.last5h.totalCostEur).toBeCloseTo(0.2944, 6);
    expect(merged.usageSummary.last7d.totalCostUsd).toBeCloseTo(1.6, 6);
    expect(merged.usageSummary.last7d.totalCostEur).toBeCloseTo(1.472, 6);
    expect(merged.fallback).toEqual({
      last5h: true,
      last7d: true,
      active: true,
    });
  });

  it("clamps fallback EUR to baseline when resolved density is below minimum floor", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummaryWithWindows(
        { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
        {
          totalTokens: 1_000_000,
          totalCostUsd: 1,
          totalCostEur: 0.92,
          accounts: [{ accountId: "acc-1", tokens: 1_000_000, costUsd: 1, costEur: 0.92 }],
        },
      ),
      createWindows(640, 3200),
    );

    expect(merged.fallback).toEqual({
      last5h: true,
      last7d: false,
      active: true,
    });
    expect(merged.usageSummary.last5h.totalCostUsd).toBeCloseTo(0.00192, 8);
    expect(merged.usageSummary.last5h.totalCostEur).toBeCloseTo(0.0017664, 8);
    expect(merged.usageSummary.last7d.totalCostUsd).toBe(1);
    expect(merged.usageSummary.last7d.totalCostEur).toBe(0.92);
  });

  it("preserves higher fallback density when resolved density is above baseline", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummaryWithWindows(
        { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
        {
          totalTokens: 1_000_000,
          totalCostUsd: 6,
          totalCostEur: 5.52,
          accounts: [{ accountId: "acc-1", tokens: 1_000_000, costUsd: 6, costEur: 5.52 }],
        },
      ),
      createWindows(640, 3200),
    );

    expect(merged.fallback).toEqual({
      last5h: true,
      last7d: false,
      active: true,
    });
    expect(merged.usageSummary.last5h.totalCostUsd).toBeCloseTo(0.00384, 8);
    expect(merged.usageSummary.last5h.totalCostEur).toBeCloseTo(0.0035328, 8);
  });

  it("keeps fallback replacement window-scoped for last5h and last7d", () => {
    const merged = mergeRequestLogUsageSummaryWithLiveFallback(
      createRequestSummaryWithWindows(
        { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
        { totalTokens: 0, totalCostUsd: 0, totalCostEur: 0, accounts: [] },
      ),
      createWindows(640, 3200),
    );

    expect(merged.fallback).toEqual({
      last5h: true,
      last7d: true,
      active: true,
    });
    expect(merged.usageSummary.last5h.totalCostUsd).toBeCloseTo(0.00192, 8);
    expect(merged.usageSummary.last7d.totalCostUsd).toBeCloseTo(0.0096, 8);
  });
});
