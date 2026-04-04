import { Activity, AlertTriangle, Coins, DollarSign } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { buildDonutPalette } from "@/utils/colors";
import { buildAccountIdentityKey } from "@/utils/account-identifiers";
import {
  formatCachedTokensMeta,
  formatCompactNumber,
  formatCurrency,
  formatRate,
  formatWindowLabel,
} from "@/utils/formatters";
import { resolveEffectiveAccountStatus } from "@/utils/account-status";
import { hasRecentUsageSignal } from "@/utils/account-working";

import type {
  AccountSummary,
  DashboardOverview,
  Depletion,
  RequestLog,
  TrendPoint,
  UsageWindow,
} from "@/features/dashboard/schemas";

export type RemainingItem = {
  accountId: string;
  label: string;
  /** Suffix appended after the label (e.g. compact account ID for duplicates). Not blurred. */
  labelSuffix: string;
  /** True when the displayed label is the account email (should be blurred in privacy mode). */
  isEmail: boolean;
  value: number;
  remainingPercent: number | null;
  color: string;
};

export type DashboardStat = {
  label: string;
  value: string;
  meta?: string;
  icon: LucideIcon;
  trend: { value: number }[];
  trendColor: string;
};

export interface SafeLineView {
  safePercent: number;
  riskLevel: "safe" | "warning" | "danger" | "critical";
}

export type DashboardView = {
  stats: DashboardStat[];
  primaryUsageItems: RemainingItem[];
  secondaryUsageItems: RemainingItem[];
  primaryTotal: number;
  secondaryTotal: number;
  requestLogs: RequestLog[];
  safeLinePrimary: SafeLineView | null;
  safeLineSecondary: SafeLineView | null;
};

function compareNullableNumberDesc(
  left: number | null | undefined,
  right: number | null | undefined,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function sortRemainingItemsByQuotaPriority(
  primaryItems: RemainingItem[],
  secondaryItems: RemainingItem[],
): { primary: RemainingItem[]; secondary: RemainingItem[] } {
  const primaryByAccountId = new Map(
    primaryItems.map((item) => [item.accountId, item.value]),
  );
  const secondaryByAccountId = new Map(
    secondaryItems.map((item) => [item.accountId, item.value]),
  );

  const compareItems = (left: RemainingItem, right: RemainingItem): number => {
    const primaryDiff = compareNullableNumberDesc(
      primaryByAccountId.get(left.accountId),
      primaryByAccountId.get(right.accountId),
    );
    if (primaryDiff !== 0) return primaryDiff;

    const secondaryDiff = compareNullableNumberDesc(
      secondaryByAccountId.get(left.accountId),
      secondaryByAccountId.get(right.accountId),
    );
    if (secondaryDiff !== 0) return secondaryDiff;

    const labelDiff = left.label.localeCompare(right.label);
    if (labelDiff !== 0) return labelDiff;

    return left.accountId.localeCompare(right.accountId);
  };

  return {
    primary: [...primaryItems].sort(compareItems),
    secondary: [...secondaryItems].sort(compareItems),
  };
}

export function buildDepletionView(depletion: Depletion | null | undefined): SafeLineView | null {
  if (!depletion || depletion.riskLevel === "safe") return null;
  return { safePercent: depletion.safeUsagePercent, riskLevel: depletion.riskLevel };
}

type WindowIndexEntry = {
  remainingCredits: number;
  capacityCredits: number;
};

type GroupedWindowEntry = {
  identityKey: string;
  accountId: string;
  label: string;
  isEmail: boolean;
  remainingPercent: number | null;
  remainingCredits: number;
  capacityCredits: number;
  count: number;
};

function buildWindowIndex(window: UsageWindow | null): Map<string, WindowIndexEntry> {
  const index = new Map<string, WindowIndexEntry>();
  if (!window) {
    return index;
  }
  for (const entry of window.accounts) {
    index.set(entry.accountId, {
      remainingCredits: entry.remainingCredits,
      capacityCredits: entry.capacityCredits,
    });
  }
  return index;
}

function isWeeklyOnlyAccount(account: AccountSummary): boolean {
  return account.windowMinutesPrimary == null && account.windowMinutesSecondary != null;
}

function accountRemainingPercent(account: AccountSummary, windowKey: "primary" | "secondary"): number | null {
  if (windowKey === "secondary") {
    return account.usage?.secondaryRemainingPercent ?? null;
  }
  return account.usage?.primaryRemainingPercent ?? null;
}

function shouldReplaceGroupedEntry(current: GroupedWindowEntry, candidate: GroupedWindowEntry): boolean {
  if (candidate.remainingCredits < current.remainingCredits) {
    return true;
  }
  if (candidate.remainingCredits > current.remainingCredits) {
    return false;
  }
  if (candidate.remainingPercent != null && current.remainingPercent == null) {
    return true;
  }
  if (candidate.remainingPercent == null || current.remainingPercent == null) {
    return false;
  }
  return candidate.remainingPercent < current.remainingPercent;
}

function buildGroupedWindowEntries(
  accounts: AccountSummary[],
  window: UsageWindow | null,
  windowKey: "primary" | "secondary",
): GroupedWindowEntry[] {
  const usageIndex = buildWindowIndex(window);
  const grouped = new Map<string, GroupedWindowEntry>();
  const activeAccounts = accounts.filter((account) => {
    const effectiveStatus = resolveEffectiveAccountStatus({
      status: account.status,
      isActiveSnapshot: account.codexAuth?.isActiveSnapshot,
      hasLiveSession: account.codexAuth?.hasLiveSession,
      hasRecentUsageSignal:
        (account.codexAuth?.hasSnapshot ?? false) && hasRecentUsageSignal(account),
    });
    return effectiveStatus !== "deactivated";
  });
  const candidateAccounts = activeAccounts.length > 0 ? activeAccounts : accounts;

  for (const account of candidateAccounts) {
    if (windowKey === "primary" && isWeeklyOnlyAccount(account)) {
      continue;
    }

    const usageEntry = usageIndex.get(account.accountId);
    const rawLabel = account.displayName || account.email || account.accountId;
    const entry: GroupedWindowEntry = {
      identityKey: buildAccountIdentityKey(account),
      accountId: account.accountId,
      label: rawLabel,
      isEmail: !!account.email && rawLabel === account.email,
      remainingPercent: accountRemainingPercent(account, windowKey),
      remainingCredits: usageEntry?.remainingCredits ?? 0,
      capacityCredits: usageEntry?.capacityCredits ?? 0,
      count: 1,
    };

    const existing = grouped.get(entry.identityKey);
    if (!existing) {
      grouped.set(entry.identityKey, entry);
      continue;
    }

    const nextCount = existing.count + 1;
    if (shouldReplaceGroupedEntry(existing, entry)) {
      grouped.set(entry.identityKey, {
        ...entry,
        count: nextCount,
      });
    } else {
      grouped.set(entry.identityKey, {
        ...existing,
        count: nextCount,
      });
    }
  }

  return Array.from(grouped.values());
}

/**
 * Cap primary (5h) remaining by secondary (7d) absolute credits.
 *
 * The 7d window is a hard quota gate — when its remaining credits are lower
 * than the 5h remaining credits, the account can only use up to the 7d amount
 * regardless of 5h headroom.  Comparing absolute credits (not percentages) is
 * essential because the two windows have vastly different capacities
 * (e.g. 225 vs 7 560 for Plus plans).
 */
export function applySecondaryConstraint(
  primaryItems: RemainingItem[],
  secondaryItems: RemainingItem[],
): RemainingItem[] {
  const secondaryByAccount = new Map<string, RemainingItem>();
  for (const item of secondaryItems) {
    secondaryByAccount.set(item.accountId, item);
  }

  return primaryItems.map((item) => {
    const secondaryItem = secondaryByAccount.get(item.accountId);
    if (!secondaryItem) return item;
    if (secondaryItem.value >= item.value) return item;

    const effectivePercent =
      item.remainingPercent != null && item.value > 0
        ? item.remainingPercent * (secondaryItem.value / item.value)
        : item.remainingPercent;

    return {
      ...item,
      value: Math.max(0, secondaryItem.value),
      remainingPercent: effectivePercent != null ? Math.max(0, effectivePercent) : null,
    };
  });
}

export function buildRemainingItems(
  accounts: AccountSummary[],
  window: UsageWindow | null,
  windowKey: "primary" | "secondary",
  isDark = false,
): RemainingItem[] {
  const groupedEntries = buildGroupedWindowEntries(accounts, window, windowKey);
  const palette = buildDonutPalette(groupedEntries.length, isDark);

  return groupedEntries.map((entry, index) => ({
    accountId: entry.accountId,
    label: entry.label,
    labelSuffix: entry.count > 1 ? ` (×${entry.count})` : "",
    isEmail: entry.isEmail,
    value: entry.remainingCredits,
    remainingPercent: entry.remainingPercent,
    color: palette[index % palette.length],
  }));
}

function buildGroupedWindowTotalCapacity(
  accounts: AccountSummary[],
  window: UsageWindow | null,
  windowKey: "primary" | "secondary",
): number {
  return buildGroupedWindowEntries(accounts, window, windowKey).reduce(
    (sum, entry) => sum + Math.max(0, entry.capacityCredits),
    0,
  );
}

export function avgPerHour(cost7d: number, hours = 24 * 7): number {
  if (!Number.isFinite(cost7d) || cost7d <= 0 || hours <= 0) {
    return 0;
  }
  return cost7d / hours;
}

const TREND_COLORS = ["#3b82f6", "#8b5cf6", "#10b981", "#f59e0b"];

function trendPointsToValues(points: TrendPoint[]): { value: number }[] {
  return points.map((p) => ({ value: p.v }));
}

export function buildDashboardView(
  overview: DashboardOverview,
  requestLogs: RequestLog[],
  isDark = false,
): DashboardView {
  const primaryWindow = overview.windows.primary;
  const secondaryWindow = overview.windows.secondary;
  const metrics = overview.summary.metrics;
  const cost = overview.summary.cost.totalUsd7d;
  const secondaryLabel = formatWindowLabel("secondary", secondaryWindow?.windowMinutes ?? null);
  const trends = overview.trends;

  const stats: DashboardStat[] = [
    {
      label: "Requests (7d)",
      value: formatCompactNumber(metrics?.requests7d ?? 0),
      meta: `Avg/day ${formatCompactNumber(Math.round((metrics?.requests7d ?? 0) / 7))}`,
      icon: Activity,
      trend: trendPointsToValues(trends.requests),
      trendColor: TREND_COLORS[0],
    },
    {
      label: `Tokens (${secondaryLabel})`,
      value: formatCompactNumber(metrics?.tokensSecondaryWindow ?? 0),
      meta: formatCachedTokensMeta(metrics?.tokensSecondaryWindow, metrics?.cachedTokensSecondaryWindow),
      icon: Coins,
      trend: trendPointsToValues(trends.tokens),
      trendColor: TREND_COLORS[1],
    },
    {
      label: "Cost (7d)",
      value: formatCurrency(cost),
      meta: `Avg/hr ${formatCurrency(avgPerHour(cost))}`,
      icon: DollarSign,
      trend: trendPointsToValues(trends.cost),
      trendColor: TREND_COLORS[2],
    },
    {
      label: "Error rate",
      value: formatRate(metrics?.errorRate7d ?? null),
      meta: metrics?.topError
        ? `Top: ${metrics.topError}`
        : `~${formatCompactNumber(Math.round((metrics?.errorRate7d ?? 0) * (metrics?.requests7d ?? 0)))} errors in 7d`,
      icon: AlertTriangle,
      trend: trendPointsToValues(trends.errorRate),
      trendColor: TREND_COLORS[3],
    },
  ];

  const activeAccounts = overview.accounts.filter((account) => {
    const effectiveStatus = resolveEffectiveAccountStatus({
      status: account.status,
      isActiveSnapshot: account.codexAuth?.isActiveSnapshot,
      hasLiveSession: account.codexAuth?.hasLiveSession,
      hasRecentUsageSignal:
        (account.codexAuth?.hasSnapshot ?? false) && hasRecentUsageSignal(account),
    });
    return effectiveStatus === "active";
  });
  const donutAccounts = activeAccounts.length > 0 ? activeAccounts : overview.accounts;

  const rawPrimaryItems = buildRemainingItems(donutAccounts, primaryWindow, "primary", isDark);
  const secondaryUsageItems = buildRemainingItems(donutAccounts, secondaryWindow, "secondary", isDark);
  const constrainedPrimaryUsageItems = secondaryWindow
    ? applySecondaryConstraint(rawPrimaryItems, secondaryUsageItems)
    : rawPrimaryItems;
  const sortedUsageItems = sortRemainingItemsByQuotaPriority(
    constrainedPrimaryUsageItems,
    secondaryUsageItems,
  );
  const primaryTotal = buildGroupedWindowTotalCapacity(donutAccounts, primaryWindow, "primary");
  const secondaryTotal = buildGroupedWindowTotalCapacity(donutAccounts, secondaryWindow, "secondary");

  return {
    stats,
    primaryUsageItems: sortedUsageItems.primary,
    secondaryUsageItems: sortedUsageItems.secondary,
    primaryTotal,
    secondaryTotal,
    requestLogs,
    safeLinePrimary: buildDepletionView(overview.depletionPrimary),
    safeLineSecondary: buildDepletionView(overview.depletionSecondary),
  };
}
