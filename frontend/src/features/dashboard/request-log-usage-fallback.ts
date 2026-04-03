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

type CostDensity = {
  usdPerToken: number;
  eurPerToken: number;
};

function resolveCostDensity(window: RequestLogUsageSummary["last5h"]): CostDensity | null {
  if (window.totalTokens <= 0) {
    return null;
  }
  return {
    usdPerToken: Math.max(0, window.totalCostUsd / window.totalTokens),
    eurPerToken: Math.max(0, window.totalCostEur / window.totalTokens),
  };
}

function resolveFallbackCostDensity(summary: RequestLogUsageSummary): {
  primary: CostDensity;
  secondary: CostDensity;
} {
  const primaryDensity = resolveCostDensity(summary.last5h);
  const secondaryDensity = resolveCostDensity(summary.last7d);

  const aggregateTokens = summary.last5h.totalTokens + summary.last7d.totalTokens;
  const aggregateDensity: CostDensity = aggregateTokens > 0
    ? {
      usdPerToken: Math.max(
        0,
        (summary.last5h.totalCostUsd + summary.last7d.totalCostUsd) / aggregateTokens,
      ),
      eurPerToken: Math.max(
        0,
        (summary.last5h.totalCostEur + summary.last7d.totalCostEur) / aggregateTokens,
      ),
    }
    : { usdPerToken: 0, eurPerToken: 0 };

  return {
    primary: primaryDensity ?? secondaryDensity ?? aggregateDensity,
    secondary: secondaryDensity ?? primaryDensity ?? aggregateDensity,
  };
}

function toConsumedTokens(
  window: UsageWindow | null | undefined,
  density: CostDensity,
): RequestLogUsageSummary["last5h"] {
  if (!window) {
    return EMPTY_USAGE_WINDOW;
  }

  const accounts = window.accounts
    .map((row) => ({
      accountId: row.accountId,
      tokens: Math.max(0, row.capacityCredits - row.remainingCredits),
      costUsd: Math.max(0, (row.capacityCredits - row.remainingCredits) * density.usdPerToken),
      costEur: Math.max(0, (row.capacityCredits - row.remainingCredits) * density.eurPerToken),
    }))
    .sort((left, right) => right.tokens - left.tokens);

  return {
    totalTokens: accounts.reduce((total, row) => total + row.tokens, 0),
    totalCostUsd: accounts.reduce((total, row) => total + row.costUsd, 0),
    totalCostEur: accounts.reduce((total, row) => total + row.costEur, 0),
    accounts,
  };
}

export function buildLiveUsageFallbackSummary(
  windows: DashboardOverview["windows"] | null | undefined,
  requestSummary: RequestLogUsageSummary,
): RequestLogUsageSummary {
  const density = resolveFallbackCostDensity(requestSummary);
  return {
    last5h: toConsumedTokens(windows?.primary, density.primary),
    last7d: toConsumedTokens(windows?.secondary, density.secondary),
    fxRateUsdToEur: requestSummary.fxRateUsdToEur,
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
  const liveUsageSummary = buildLiveUsageFallbackSummary(windows, requestUsageSummary);

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
