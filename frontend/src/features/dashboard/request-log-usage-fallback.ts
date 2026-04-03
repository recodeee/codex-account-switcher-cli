import type { DashboardOverview, RequestLogUsageSummary, UsageWindow } from "@/features/dashboard/schemas";

export type RequestLogUsageFallbackState = {
  last5h: boolean;
  last7d: boolean;
  active: boolean;
};

export type MergedRequestLogUsageSummary = {
  usageSummary: RequestLogUsageSummary;
  fallback: RequestLogUsageFallbackState;
};

const EMPTY_USAGE_WINDOW: RequestLogUsageSummary["last5h"] = {
  totalTokens: 0,
  totalCostUsd: 0,
  totalCostEur: 0,
  accounts: [],
};

function toConsumedTokens(window: UsageWindow | null | undefined): RequestLogUsageSummary["last5h"] {
  if (!window) {
    return EMPTY_USAGE_WINDOW;
  }

  const accounts = window.accounts
    .map((row) => ({
      accountId: row.accountId,
      tokens: Math.max(0, row.capacityCredits - row.remainingCredits),
      costUsd: 0,
      costEur: 0,
    }))
    .sort((left, right) => right.tokens - left.tokens);

  return {
    totalTokens: accounts.reduce((total, row) => total + row.tokens, 0),
    totalCostUsd: 0,
    totalCostEur: 0,
    accounts,
  };
}

export function buildLiveUsageFallbackSummary(
  windows: DashboardOverview["windows"] | null | undefined,
): RequestLogUsageSummary {
  return {
    last5h: toConsumedTokens(windows?.primary),
    last7d: toConsumedTokens(windows?.secondary),
    fxRateUsdToEur: 1,
  };
}

export function mergeRequestLogUsageSummaryWithLiveFallback(
  requestSummary: RequestLogUsageSummary | null | undefined,
  windows: DashboardOverview["windows"] | null | undefined,
): MergedRequestLogUsageSummary {
  const requestUsageSummary: RequestLogUsageSummary = requestSummary ?? {
    last5h: EMPTY_USAGE_WINDOW,
    last7d: EMPTY_USAGE_WINDOW,
    fxRateUsdToEur: 1,
  };
  const liveUsageSummary = buildLiveUsageFallbackSummary(windows);

  const use5hFallback =
    requestUsageSummary.last5h.totalTokens === 0 && liveUsageSummary.last5h.totalTokens > 0;
  const use7dFallback =
    requestUsageSummary.last7d.totalTokens === 0 && liveUsageSummary.last7d.totalTokens > 0;

  return {
    usageSummary: {
      last5h: use5hFallback ? liveUsageSummary.last5h : requestUsageSummary.last5h,
      last7d: use7dFallback ? liveUsageSummary.last7d : requestUsageSummary.last7d,
      fxRateUsdToEur: requestUsageSummary.fxRateUsdToEur,
    },
    fallback: {
      last5h: use5hFallback,
      last7d: use7dFallback,
      active: use5hFallback || use7dFallback,
    },
  };
}
