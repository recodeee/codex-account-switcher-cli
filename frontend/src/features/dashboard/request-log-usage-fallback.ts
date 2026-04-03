import type { AccountSummary } from "@/features/accounts/schemas";
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

const FALLBACK_USD_PER_MILLION_TOKENS = 3;

function hasPositiveDensity(density: CostDensity | null | undefined): density is CostDensity {
  if (!density) return false;
  return density.usdPerToken > 0 || density.eurPerToken > 0;
}

function resolveCostDensity(window: RequestLogUsageSummary["last5h"]): CostDensity | null {
  if (window.totalTokens <= 0) {
    return null;
  }
  const density = {
    usdPerToken: Math.max(0, window.totalCostUsd / window.totalTokens),
    eurPerToken: Math.max(0, window.totalCostEur / window.totalTokens),
  };
  return hasPositiveDensity(density) ? density : null;
}

function resolveAggregateDensity(summary: RequestLogUsageSummary): CostDensity | null {
  const aggregateTokens = summary.last5h.totalTokens + summary.last7d.totalTokens;
  if (aggregateTokens <= 0) {
    return null;
  }
  const density = {
    usdPerToken: Math.max(
      0,
      (summary.last5h.totalCostUsd + summary.last7d.totalCostUsd) / aggregateTokens,
    ),
    eurPerToken: Math.max(
      0,
      (summary.last5h.totalCostEur + summary.last7d.totalCostEur) / aggregateTokens,
    ),
  };
  return hasPositiveDensity(density) ? density : null;
}

function resolveAccountUsageDensity(
  accounts: AccountSummary[] | null | undefined,
  fxRateUsdToEur: number,
): CostDensity | null {
  if (!accounts?.length) {
    return null;
  }

  let totalTokens = 0;
  let totalCostUsd = 0;
  for (const account of accounts) {
    const tokens = account.requestUsage?.totalTokens ?? 0;
    const costUsd = account.requestUsage?.totalCostUsd ?? 0;
    if (tokens <= 0 || costUsd <= 0) {
      continue;
    }
    totalTokens += tokens;
    totalCostUsd += costUsd;
  }

  if (totalTokens <= 0 || totalCostUsd <= 0) {
    return null;
  }

  const usdPerToken = totalCostUsd / totalTokens;
  const density = {
    usdPerToken,
    eurPerToken: usdPerToken * fxRateUsdToEur,
  };
  return hasPositiveDensity(density) ? density : null;
}

function resolveBaselineDensity(fxRateUsdToEur: number): CostDensity {
  const usdPerToken = FALLBACK_USD_PER_MILLION_TOKENS / 1_000_000;
  return {
    usdPerToken,
    eurPerToken: usdPerToken * fxRateUsdToEur,
  };
}

function pickDensity(candidates: Array<CostDensity | null | undefined>): CostDensity | null {
  for (const candidate of candidates) {
    if (hasPositiveDensity(candidate)) {
      return candidate;
    }
  }
  return null;
}

function resolveFallbackCostDensity(
  summary: RequestLogUsageSummary,
  accounts: AccountSummary[] | null | undefined,
): {
  primary: CostDensity;
  secondary: CostDensity;
} {
  const fxRateUsdToEur = summary.fxRateUsdToEur > 0 ? summary.fxRateUsdToEur : 1;
  const primaryDensity = resolveCostDensity(summary.last5h);
  const secondaryDensity = resolveCostDensity(summary.last7d);
  const aggregateDensity = resolveAggregateDensity(summary);
  const accountUsageDensity = resolveAccountUsageDensity(accounts, fxRateUsdToEur);
  const baselineDensity = resolveBaselineDensity(fxRateUsdToEur);

  return {
    primary:
      pickDensity([
        primaryDensity,
        secondaryDensity,
        aggregateDensity,
        accountUsageDensity,
        baselineDensity,
      ]) ?? { usdPerToken: 0, eurPerToken: 0 },
    secondary:
      pickDensity([
        secondaryDensity,
        primaryDensity,
        aggregateDensity,
        accountUsageDensity,
        baselineDensity,
      ]) ?? { usdPerToken: 0, eurPerToken: 0 },
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
  accounts: AccountSummary[] | null | undefined,
): RequestLogUsageSummary {
  const density = resolveFallbackCostDensity(requestSummary, accounts);
  return {
    last5h: toConsumedTokens(windows?.primary, density.primary),
    last7d: toConsumedTokens(windows?.secondary, density.secondary),
    fxRateUsdToEur: requestSummary.fxRateUsdToEur,
  };
}

export function mergeRequestLogUsageSummaryWithLiveFallback(
  requestSummary: RequestLogUsageSummary | null | undefined,
  windows: DashboardOverview["windows"] | null | undefined,
  accounts?: AccountSummary[] | null,
): MergedRequestLogUsageSummary {
  const requestUsageSummary: RequestLogUsageSummary = requestSummary ?? {
    last5h: EMPTY_USAGE_WINDOW,
    last7d: EMPTY_USAGE_WINDOW,
    fxRateUsdToEur: 1,
  };
  const liveUsageSummary = buildLiveUsageFallbackSummary(windows, requestUsageSummary, accounts);

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
