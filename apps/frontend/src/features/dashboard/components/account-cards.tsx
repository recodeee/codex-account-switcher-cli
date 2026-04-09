import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Plus, Search, Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AccountCard,
  type AccountCardProps,
} from "@/features/dashboard/components/account-card";
import type {
  AccountSummary,
  RequestLogUsageSummary,
  UsageWindow,
} from "@/features/dashboard/schemas";
import {
  buildAccountIdentityKey,
  buildDuplicateAccountIdSet,
  buildQuotaDisplayAccountKey,
} from "@/utils/account-identifiers";
import {
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  hasActiveCliSessionSignal,
  hasRecentWorkingNowSignal,
  hasRecentUsageSignal,
  hasFreshLiveTelemetry,
  isAccountWorkingNow,
  noteWorkingNowSignal,
  selectStableRemainingPercent,
} from "@/utils/account-working";
import { resolveEffectiveAccountStatus } from "@/utils/account-status";
import { formatEuro, formatWindowLabel } from "@/utils/formatters";
import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";

const RECENT_LAST_SEEN_SORT_WINDOW_MS = 30 * 60 * 1000;
const WEEKLY_DEPLETED_SORT_THRESHOLD_PERCENT = 5;
const QUOTA_SORT_BUCKET_PERCENT = 5;
const ACCOUNT_CARDS_CLOCK_TICK_MS = 5_000;
const EMAIL_AUTOCORRECT_MAX_DISTANCE = 3;
const ACCOUNT_GRID_CLASSNAME =
  "grid auto-rows-fr items-stretch gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,21.5rem),1fr))] [&_.card-hover]:h-full";
const WORKING_ACCOUNT_GRID_CLASSNAME =
  "grid auto-rows-fr items-stretch gap-4 grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 [&_.card-hover]:h-full";
const WORKING_ACCOUNT_PLACEHOLDER_TARGET = 3;

type OtherAccountsSortMode =
  | "available-first"
  | "usage-limit-available-first"
  | "stable";

function normalizeEmailSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function matchesOtherAccountEmailQuery(
  account: AccountSummary,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) {
    return true;
  }
  return normalizeEmailSearchValue(account.email).includes(normalizedQuery);
}

function computeLevenshteinDistance(source: string, target: string): number {
  if (source === target) {
    return 0;
  }
  if (source.length === 0) {
    return target.length;
  }
  if (target.length === 0) {
    return source.length;
  }

  const previousRow = Array.from(
    { length: target.length + 1 },
    (_, index) => index,
  );
  const currentRow = new Array<number>(target.length + 1);

  for (let sourceIndex = 1; sourceIndex <= source.length; sourceIndex += 1) {
    currentRow[0] = sourceIndex;
    for (let targetIndex = 1; targetIndex <= target.length; targetIndex += 1) {
      const substitutionCost =
        source[sourceIndex - 1] === target[targetIndex - 1] ? 0 : 1;
      currentRow[targetIndex] = Math.min(
        previousRow[targetIndex] + 1,
        currentRow[targetIndex - 1] + 1,
        previousRow[targetIndex - 1] + substitutionCost,
      );
    }
    previousRow.splice(0, previousRow.length, ...currentRow);
  }

  return previousRow[target.length] ?? 0;
}

function resolveEmailAutocorrection(
  value: string,
  emailOptions: string[],
): string | null {
  const normalizedValue = normalizeEmailSearchValue(value);
  if (!normalizedValue) {
    return null;
  }

  const normalizedOptions = emailOptions
    .map((email) => ({
      email,
      normalizedEmail: normalizeEmailSearchValue(email),
    }))
    .filter((option) => option.normalizedEmail.length > 0);

  if (normalizedOptions.length === 0) {
    return null;
  }
  if (
    normalizedOptions.some(
      (option) => option.normalizedEmail === normalizedValue,
    )
  ) {
    return null;
  }

  let bestMatch: { email: string; distance: number } | null = null;
  for (const option of normalizedOptions) {
    const [localPart = option.normalizedEmail] =
      option.normalizedEmail.split("@");
    const distance = Math.min(
      computeLevenshteinDistance(normalizedValue, option.normalizedEmail),
      computeLevenshteinDistance(normalizedValue, localPart),
    );
    if (!bestMatch || distance < bestMatch.distance) {
      bestMatch = { email: option.email, distance };
    }
  }

  if (!bestMatch) {
    return null;
  }

  const maxDistance = Math.min(
    EMAIL_AUTOCORRECT_MAX_DISTANCE,
    Math.max(1, Math.floor(normalizedValue.length * 0.25)),
  );
  if (bestMatch.distance <= maxDistance) {
    return bestMatch.email;
  }
  return null;
}

function compareNullableNumberDesc(
  left: number | null,
  right: number | null,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function compareNullableNumberAsc(
  left: number | null,
  right: number | null,
): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function parseTimestampMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function normalizeNearZeroQuotaPercent(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped > 0 && clamped < WEEKLY_DEPLETED_SORT_THRESHOLD_PERCENT) {
    return 0;
  }
  return clamped;
}

function bucketizeQuotaPercent(value: number | null): number | null {
  if (value == null) {
    return null;
  }
  return (
    Math.floor(
      normalizeNearZeroQuotaPercent(value) / QUOTA_SORT_BUCKET_PERCENT,
    ) * QUOTA_SORT_BUCKET_PERCENT
  );
}

function resolveSortableRemainingPercent(
  account: AccountSummary,
  windowKey: "primary" | "secondary",
  nowMs: number,
): number | null {
  const mergedRemainingPercent = getMergedQuotaRemainingPercent(
    account,
    windowKey,
  );
  const deferredQuotaFallback = getRawQuotaWindowFallback(account, windowKey);
  const baselineRemainingPercent =
    windowKey === "primary"
      ? account.usage?.primaryRemainingPercent
      : account.usage?.secondaryRemainingPercent;
  const baselineResetAt =
    windowKey === "primary" ? account.resetAtPrimary : account.resetAtSecondary;
  const baselineRecordedAt =
    windowKey === "primary"
      ? account.lastUsageRecordedAtPrimary
      : account.lastUsageRecordedAtSecondary;
  const hasLiveSession = hasFreshLiveTelemetry(account, nowMs);

  const remainingPercentRaw =
    mergedRemainingPercent ??
    selectStableRemainingPercent({
      fallbackRemainingPercent: deferredQuotaFallback?.remainingPercent,
      fallbackResetAt: deferredQuotaFallback?.resetAt,
      baselineRemainingPercent,
      baselineResetAt,
    });

  const effectiveResetAt =
    deferredQuotaFallback?.resetAt ?? baselineResetAt ?? null;
  const effectiveRecordedAt =
    deferredQuotaFallback?.recordedAt ?? baselineRecordedAt ?? null;

  return normalizeRemainingPercentForDisplay({
    accountKey: buildQuotaDisplayAccountKey(account),
    windowKey,
    remainingPercent: remainingPercentRaw,
    resetAt: effectiveResetAt,
    hasLiveSession,
    lastRecordedAt: effectiveRecordedAt,
    applyCycleFloor: mergedRemainingPercent == null,
  });
}

function buildAccountEntryKey(account: AccountSummary): string {
  return `${buildAccountIdentityKey(account)}::${buildQuotaDisplayAccountKey(account)}`;
}

function resolveSortableResetAtMs(
  account: AccountSummary,
  windowKey: "primary" | "secondary",
): number | null {
  const deferredQuotaFallback = getRawQuotaWindowFallback(account, windowKey);
  const baselineResetAt =
    windowKey === "primary" ? account.resetAtPrimary : account.resetAtSecondary;
  const effectiveResetAt =
    deferredQuotaFallback?.resetAt ?? baselineResetAt ?? null;
  return parseTimestampMs(effectiveResetAt);
}

function shouldPinWeeklyDepletedAccountToEnd(metrics: {
  primaryResetAtMs: number | null;
  secondaryResetAtMs: number | null;
  secondaryRemaining: number | null;
}): boolean {
  if (metrics.secondaryRemaining == null) {
    return false;
  }
  return normalizeNearZeroQuotaPercent(metrics.secondaryRemaining) <= 0;
}

function sortAccountsByAvailableQuota(
  accounts: AccountSummary[],
  nowMs: number,
): AccountSummary[] {
  const sortMetricsByAccount = new Map(
    accounts.map((account) => {
      const primaryRemaining = resolveSortableRemainingPercent(
        account,
        "primary",
        nowMs,
      );
      const secondaryRemaining = resolveSortableRemainingPercent(
        account,
        "secondary",
        nowMs,
      );
      return [
        account,
        {
          primaryRemaining,
          primarySortBucket: bucketizeQuotaPercent(primaryRemaining),
          primaryResetAtMs: resolveSortableResetAtMs(account, "primary"),
          secondaryResetAtMs: resolveSortableResetAtMs(account, "secondary"),
          secondaryRemaining,
          secondarySortBucket: bucketizeQuotaPercent(secondaryRemaining),
          title: account.displayName || account.email || account.accountId,
        },
      ] as const;
    }),
  );

  return [...accounts].sort((left, right) => {
    const leftMetrics = sortMetricsByAccount.get(left);
    const rightMetrics = sortMetricsByAccount.get(right);
    if (!leftMetrics || !rightMetrics) {
      return left.accountId.localeCompare(right.accountId);
    }

    const leftWeeklyDepletedPinned =
      shouldPinWeeklyDepletedAccountToEnd(leftMetrics);
    const rightWeeklyDepletedPinned =
      shouldPinWeeklyDepletedAccountToEnd(rightMetrics);
    if (leftWeeklyDepletedPinned !== rightWeeklyDepletedPinned) {
      return leftWeeklyDepletedPinned ? 1 : -1;
    }
    if (leftWeeklyDepletedPinned && rightWeeklyDepletedPinned) {
      const weeklyResetDiff = compareNullableNumberAsc(
        leftMetrics.secondaryResetAtMs,
        rightMetrics.secondaryResetAtMs,
      );
      if (weeklyResetDiff !== 0) return weeklyResetDiff;
    }

    const primaryDiff = compareNullableNumberDesc(
      leftMetrics.primarySortBucket,
      rightMetrics.primarySortBucket,
    );
    if (primaryDiff !== 0) return primaryDiff;

    const leftPrimaryDepleted =
      leftMetrics.primaryRemaining != null && leftMetrics.primaryRemaining <= 0;
    const rightPrimaryDepleted =
      rightMetrics.primaryRemaining != null &&
      rightMetrics.primaryRemaining <= 0;
    if (leftPrimaryDepleted && rightPrimaryDepleted) {
      const primaryResetDiff = compareNullableNumberAsc(
        leftMetrics.primaryResetAtMs,
        rightMetrics.primaryResetAtMs,
      );
      if (primaryResetDiff !== 0) return primaryResetDiff;
    }

    const secondaryDiff = compareNullableNumberDesc(
      leftMetrics.secondarySortBucket,
      rightMetrics.secondarySortBucket,
    );
    if (secondaryDiff !== 0) return secondaryDiff;

    return leftMetrics.title.localeCompare(rightMetrics.title);
  });
}

function sortAccountsByStableOrder(
  accounts: AccountSummary[],
  stableOrder: Map<string, number>,
): AccountSummary[] {
  return [...accounts].sort((left, right) => {
    const leftRank =
      stableOrder.get(buildAccountEntryKey(left)) ?? Number.MAX_SAFE_INTEGER;
    const rightRank =
      stableOrder.get(buildAccountEntryKey(right)) ?? Number.MAX_SAFE_INTEGER;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return left.accountId.localeCompare(right.accountId);
  });
}

function isUsageLimitAvailableAccount(
  account: AccountSummary,
  nowMs: number,
): boolean {
  const primaryRemaining = resolveSortableRemainingPercent(
    account,
    "primary",
    nowMs,
  );
  const secondaryRemaining = resolveSortableRemainingPercent(
    account,
    "secondary",
    nowMs,
  );
  const usageLimitHit =
    account.status === "rate_limited" ||
    account.status === "quota_exceeded" ||
    (primaryRemaining != null &&
      normalizeNearZeroQuotaPercent(primaryRemaining) <= 0);
  const weeklyAvailable =
    secondaryRemaining == null ||
    normalizeNearZeroQuotaPercent(secondaryRemaining) > 0;

  return usageLimitHit && weeklyAvailable;
}

function sortAccountsByUsageLimitAvailableFirst(
  accounts: AccountSummary[],
  nowMs: number,
): AccountSummary[] {
  const usageLimitAvailable: AccountSummary[] = [];
  const otherAccounts: AccountSummary[] = [];

  const orderedByAvailability = sortAccountsByLastSeenAndAvailableQuota(
    accounts,
    nowMs,
  );
  for (const account of orderedByAvailability) {
    if (isUsageLimitAvailableAccount(account, nowMs)) {
      usageLimitAvailable.push(account);
    } else {
      otherAccounts.push(account);
    }
  }

  return [...usageLimitAvailable, ...otherAccounts];
}

function resolveMostRecentUsageRecordedAtMs(
  account: AccountSummary,
): number | null {
  const primaryRecordedAt =
    getRawQuotaWindowFallback(account, "primary")?.recordedAt ??
    account.lastUsageRecordedAtPrimary ??
    null;
  const secondaryRecordedAt =
    getRawQuotaWindowFallback(account, "secondary")?.recordedAt ??
    account.lastUsageRecordedAtSecondary ??
    null;
  const primaryRecordedAtMs = parseTimestampMs(primaryRecordedAt);
  const secondaryRecordedAtMs = parseTimestampMs(secondaryRecordedAt);

  if (primaryRecordedAtMs == null && secondaryRecordedAtMs == null) {
    return null;
  }

  return Math.max(
    primaryRecordedAtMs ?? Number.NEGATIVE_INFINITY,
    secondaryRecordedAtMs ?? Number.NEGATIVE_INFINITY,
  );
}

function hasRecentLastSeenUsage(
  account: AccountSummary,
  nowMs: number = Date.now(),
): boolean {
  const mostRecentUsageRecordedAtMs =
    resolveMostRecentUsageRecordedAtMs(account);
  if (mostRecentUsageRecordedAtMs == null) {
    return false;
  }
  return nowMs - mostRecentUsageRecordedAtMs <= RECENT_LAST_SEEN_SORT_WINDOW_MS;
}

function sortAccountsByLastSeenAndAvailableQuota(
  accounts: AccountSummary[],
  nowMs: number = Date.now(),
): AccountSummary[] {
  const weeklyAvailableAccounts: AccountSummary[] = [];
  const weeklyDepletedAccounts: AccountSummary[] = [];

  for (const account of accounts) {
    const weeklyRemaining = resolveSortableRemainingPercent(
      account,
      "secondary",
      nowMs,
    );
    const shouldPinWeeklyDepleted = shouldPinWeeklyDepletedAccountToEnd({
      primaryResetAtMs: resolveSortableResetAtMs(account, "primary"),
      secondaryResetAtMs: resolveSortableResetAtMs(account, "secondary"),
      secondaryRemaining: weeklyRemaining,
    });

    if (shouldPinWeeklyDepleted) {
      weeklyDepletedAccounts.push(account);
    } else {
      weeklyAvailableAccounts.push(account);
    }
  }

  const recentAccounts: AccountSummary[] = [];
  const staleAccounts: AccountSummary[] = [];

  for (const account of weeklyAvailableAccounts) {
    if (hasRecentLastSeenUsage(account, nowMs)) {
      recentAccounts.push(account);
    } else {
      staleAccounts.push(account);
    }
  }

  return [
    ...sortAccountsByAvailableQuota(recentAccounts, nowMs),
    ...sortAccountsByAvailableQuota(staleAccounts, nowMs),
    ...sortAccountsByAvailableQuota(weeklyDepletedAccounts, nowMs),
  ];
}

export type AccountCardsProps = {
  accounts: AccountSummary[];
  primaryWindow: UsageWindow | null;
  secondaryWindow: UsageWindow | null;
  primaryUsageSummary?: RequestLogUsageSummary["last5h"] | null;
  useLocalBusy?: boolean;
  useLocalBusyAccountId?: string | null;
  deleteBusy?: boolean;
  onAction?: AccountCardProps["onAction"];
};

function formatConsumedCostEur(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) {
    return "--";
  }
  return formatEuro(Math.max(0, value));
}

function buildRemainingByAccount(
  window: UsageWindow | null,
): Map<string, number> {
  const remainingByAccount = new Map<string, number>();
  if (!window) return remainingByAccount;

  for (const row of window.accounts) {
    if (row.remainingPercentAvg == null) {
      continue;
    }
    remainingByAccount.set(row.accountId, Math.max(0, row.remainingCredits));
  }

  return remainingByAccount;
}

function resolveCardTokensRemaining(
  account: AccountSummary,
  primaryRemainingByAccount: Map<string, number>,
  secondaryRemainingByAccount: Map<string, number>,
): number | null {
  const weeklyOnly =
    account.windowMinutesPrimary == null &&
    account.windowMinutesSecondary != null;
  const primaryRemaining = primaryRemainingByAccount.get(account.accountId);
  const secondaryRemaining = secondaryRemainingByAccount.get(account.accountId);

  if (weeklyOnly && secondaryRemaining != null) {
    return secondaryRemaining;
  }

  if (primaryRemaining != null && secondaryRemaining != null) {
    return Math.min(primaryRemaining, secondaryRemaining);
  }

  if (primaryRemaining != null) {
    return primaryRemaining;
  }

  if (secondaryRemaining != null) {
    return secondaryRemaining;
  }

  return null;
}

export function AccountCards({
  accounts,
  primaryWindow,
  secondaryWindow,
  primaryUsageSummary = null,
  useLocalBusy = false,
  useLocalBusyAccountId = null,
  deleteBusy = false,
  onAction,
}: AccountCardsProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [otherAccountsSortMode, setOtherAccountsSortMode] =
    useState<OtherAccountsSortMode>("available-first");
  const [otherAccountsEmailSearch, setOtherAccountsEmailSearch] = useState("");

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, ACCOUNT_CARDS_CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const stableAccountOrder = useMemo(
    () =>
      new Map(
        accounts.map(
          (account, index) => [buildAccountEntryKey(account), index] as const,
        ),
      ),
    [accounts],
  );

  const primaryWindowLabel = formatWindowLabel(
    "primary",
    primaryWindow?.windowMinutes ?? null,
  );
  const duplicateAccountIds = useMemo(
    () => buildDuplicateAccountIdSet(accounts),
    [accounts],
  );
  const primaryRemainingByAccount = useMemo(
    () => buildRemainingByAccount(primaryWindow),
    [primaryWindow],
  );
  const secondaryRemainingByAccount = useMemo(
    () => buildRemainingByAccount(secondaryWindow),
    [secondaryWindow],
  );
  const groupedAccounts = useMemo(() => {
    const working: AccountSummary[] = [];
    const active: AccountSummary[] = [];
    const deactivated: AccountSummary[] = [];

    for (const account of accounts) {
      const hasActiveCliSession = hasActiveCliSessionSignal(account, nowMs);
      const effectiveStatus = resolveEffectiveAccountStatus({
        status: account.status,
        hasSnapshot: account.codexAuth?.hasSnapshot,
        isActiveSnapshot: account.codexAuth?.isActiveSnapshot,
        hasLiveSession: hasActiveCliSession,
        hasRecentUsageSignal:
          (account.codexAuth?.hasSnapshot ?? false) &&
          hasRecentUsageSignal(account, nowMs),
        allowDeactivatedOverride: false,
      });

      const hasWorkingNowSignal =
        isAccountWorkingNow(account, nowMs) ||
        (account.status !== "deactivated" &&
          (account.codexAuth?.hasLiveSession ?? false) &&
          hasActiveCliSession);
      if (hasWorkingNowSignal) {
        noteWorkingNowSignal(account, nowMs);
        working.push(account);
        continue;
      }
      if (
        account.status !== "deactivated" &&
        hasRecentWorkingNowSignal(account, nowMs)
      ) {
        working.push(account);
        continue;
      }

      if (effectiveStatus === "deactivated") {
        deactivated.push(account);
      } else {
        active.push(account);
      }
    }

    return {
      working,
      remaining: [
        ...(otherAccountsSortMode === "available-first"
          ? sortAccountsByLastSeenAndAvailableQuota(active, nowMs)
          : otherAccountsSortMode === "usage-limit-available-first"
            ? sortAccountsByUsageLimitAvailableFirst(active, nowMs)
            : sortAccountsByStableOrder(active, stableAccountOrder)),
        ...(otherAccountsSortMode === "available-first"
          ? sortAccountsByLastSeenAndAvailableQuota(deactivated, nowMs)
          : otherAccountsSortMode === "usage-limit-available-first"
            ? sortAccountsByUsageLimitAvailableFirst(deactivated, nowMs)
            : sortAccountsByStableOrder(deactivated, stableAccountOrder)),
      ],
    };
  }, [accounts, nowMs, otherAccountsSortMode, stableAccountOrder]);
  const workingSummary = useMemo(() => {
    const workingAccountIds = new Set(
      groupedAccounts.working.map((account) => account.accountId),
    );
    const liveSessions = groupedAccounts.working.reduce((sum, account) => {
      if (!hasFreshLiveTelemetry(account, nowMs)) {
        return sum;
      }
      return sum + Math.max(account.codexLiveSessionCount ?? 0, 1);
    }, 0);
    const primaryConsumedTokens =
      primaryUsageSummary == null
        ? null
        : primaryUsageSummary.accounts.length === 0
          ? primaryUsageSummary.totalTokens
          : primaryUsageSummary.accounts.reduce((sum, row) => {
              if (!row.accountId || !workingAccountIds.has(row.accountId)) {
                return sum;
              }
              return sum + row.tokens;
            }, 0);
    const primaryConsumedCostEur =
      primaryUsageSummary == null
        ? null
        : primaryUsageSummary.accounts.length === 0
          ? primaryUsageSummary.totalCostEur
          : primaryUsageSummary.accounts.reduce((sum, row) => {
              if (!row.accountId || !workingAccountIds.has(row.accountId)) {
                return sum;
              }
              return sum + row.costEur;
            }, 0);

    return {
      liveSessions,
      primaryConsumedTokens,
      primaryConsumedCostEur,
    };
  }, [groupedAccounts.working, nowMs, primaryUsageSummary]);
  const otherAccountsEmailSuggestions = useMemo(() => {
    const emailSet = new Set<string>();
    for (const account of groupedAccounts.remaining) {
      const normalizedEmail = account.email.trim();
      if (normalizedEmail) {
        emailSet.add(normalizedEmail);
      }
    }
    return Array.from(emailSet).sort((left, right) =>
      left.localeCompare(right),
    );
  }, [groupedAccounts.remaining]);
  const filteredRemainingAccounts = useMemo(() => {
    const normalizedQuery = normalizeEmailSearchValue(otherAccountsEmailSearch);
    if (!normalizedQuery) {
      return groupedAccounts.remaining;
    }
    return groupedAccounts.remaining.filter((account) =>
      matchesOtherAccountEmailQuery(account, normalizedQuery),
    );
  }, [groupedAccounts.remaining, otherAccountsEmailSearch]);
  const hasOtherAccountsEmailSearch =
    normalizeEmailSearchValue(otherAccountsEmailSearch).length > 0;

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No accounts connected yet"
        description="Import or authenticate an account to get started."
      />
    );
  }

  const renderGrid = (
    items: AccountSummary[],
    keyPrefix: string,
    options?: { className?: string; placeholderCount?: number },
  ) => {
    const placeholderCount = Math.max(0, options?.placeholderCount ?? 0);
    return (
      <div className={options?.className ?? ACCOUNT_GRID_CLASSNAME}>
        {items.map((account, index) => (
          <div
            key={`${keyPrefix}-${account.accountId}`}
            className={
              keyPrefix === "working"
                ? "h-full min-w-0 animate-working-account-enter"
                : "h-full min-w-0 animate-fade-in-up"
            }
            style={
              keyPrefix === "working"
                ? ({
                    animationDelay: `${index * 85}ms`,
                    animationDuration: `${Math.min(640, 520 + index * 35)}ms`,
                  } satisfies CSSProperties)
                : ({
                    animationDelay: `${index * 60}ms`,
                  } satisfies CSSProperties)
            }
          >
            <AccountCard
              account={account}
              tokensRemaining={resolveCardTokensRemaining(
                account,
                primaryRemainingByAccount,
                secondaryRemainingByAccount,
              )}
              showTokensRemaining
              showAccountId={duplicateAccountIds.has(account.accountId)}
              useLocalBusy={
                useLocalBusy &&
                useLocalBusyAccountId != null &&
                useLocalBusyAccountId === account.accountId
              }
              deleteBusy={deleteBusy}
              initialSessionTasksCollapsed
              onAction={onAction}
            />
          </div>
        ))}
        {Array.from({ length: placeholderCount }).map((_, placeholderIndex) => (
          <div
            key={`${keyPrefix}-placeholder-${placeholderIndex}`}
            className="h-full min-w-0 animate-working-account-enter"
            style={
              {
                animationDelay: `${(items.length + placeholderIndex) * 85}ms`,
                animationDuration: `${Math.min(
                  640,
                  520 + (items.length + placeholderIndex) * 35,
                )}ms`,
              } satisfies CSSProperties
            }
          >
            <article
              data-testid="working-now-placeholder-card"
              className="flex h-full min-h-[22rem] flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-400/35 bg-[#050d18]/85 px-5 py-6 text-center"
            >
              <div className="space-y-3">
                <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-cyan-300/[0.10] text-cyan-100">
                  <Plus className="h-7 w-7" aria-hidden="true" />
                </span>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-zinc-100">
                    Add new card here
                  </p>
                  <p className="text-xs text-zinc-400">
                    Connect another account and it will appear in Working now.
                  </p>
                </div>
              </div>
            </article>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      {groupedAccounts.working.length > 0 ? (
        <section className="space-y-4 rounded-xl border border-white/10 bg-[#060A13] p-4 md:p-5">
          <div className="flex flex-col gap-4 border-b border-white/8 pb-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="text-base font-semibold tracking-tight text-zinc-100">
                Working now
              </h3>
              <p className="text-sm text-zinc-400">
                Accounts with active CLI sessions are grouped first so you can
                switch faster.
              </p>
            </div>
            <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 xl:w-auto xl:min-w-[34rem] xl:grid-cols-3">
              <span className="flex min-h-16 flex-col justify-between rounded-lg border border-white/10 bg-[#060A13] px-3.5 py-3">
                <span className="text-[11px] font-medium text-zinc-400">
                  Active accounts
                </span>
                <span className="text-base font-semibold text-zinc-100 tabular-nums">
                  {groupedAccounts.working.length} working
                </span>
              </span>
              {workingSummary.liveSessions > 0 ? (
                <span className="flex min-h-16 flex-col justify-between rounded-lg border border-white/10 bg-[#060A13] px-3.5 py-3">
                  <span className="text-[11px] font-medium text-zinc-400">
                    CLI sessions
                  </span>
                  <span className="text-base font-semibold text-zinc-100 tabular-nums">
                    {workingSummary.liveSessions} live sessions
                  </span>
                </span>
              ) : null}
              {workingSummary.primaryConsumedTokens !== null ? (
                <span className="flex min-h-16 flex-col justify-between rounded-lg border border-white/10 bg-[#060A13] px-3.5 py-3">
                  <span className="text-[11px] font-medium text-zinc-400">
                    {primaryWindowLabel} price spend
                  </span>
                  <span className="text-base font-semibold text-zinc-100 tabular-nums">
                    {formatConsumedCostEur(workingSummary.primaryConsumedCostEur)}
                  </span>
                </span>
              ) : null}
            </div>
          </div>
          {renderGrid(groupedAccounts.working, "working", {
            className: WORKING_ACCOUNT_GRID_CLASSNAME,
            placeholderCount: Math.max(
              0,
              WORKING_ACCOUNT_PLACEHOLDER_TARGET -
                groupedAccounts.working.length,
            ),
          })}
        </section>
      ) : (
        <section className="rounded-xl border border-dashed border-border/70 bg-background/25 px-4 py-6 text-center md:px-5">
          <p className="text-sm font-medium text-zinc-200">
            No account is working now currently.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Live accounts appear here automatically when active CLI telemetry is
            detected.
          </p>
        </section>
      )}

      {groupedAccounts.remaining.length > 0 ? (
        <section className="space-y-3 rounded-2xl border border-border/60 bg-background/35 p-3.5 md:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex min-w-0 items-center gap-2.5">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                Other accounts
              </h3>
              <div className="h-px w-12 bg-border/70 sm:w-24" />
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2.5">
              <div className="relative min-w-[16rem] max-w-sm flex-1 sm:w-80 sm:max-w-none sm:flex-none">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground/65"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={otherAccountsEmailSearch}
                  onChange={(event) => {
                    setOtherAccountsEmailSearch(event.target.value);
                  }}
                  onBlur={() => {
                    const correctedEmail = resolveEmailAutocorrection(
                      otherAccountsEmailSearch,
                      otherAccountsEmailSuggestions,
                    );
                    if (
                      correctedEmail &&
                      correctedEmail !== otherAccountsEmailSearch
                    ) {
                      setOtherAccountsEmailSearch(correctedEmail);
                    }
                  }}
                  className="h-10 rounded-lg border-border/75 bg-background/80 pl-10 text-sm font-medium placeholder:text-muted-foreground/70"
                  placeholder="Search by email address"
                  aria-label="Search other accounts by email"
                  list="other-accounts-email-suggestions"
                  spellCheck
                  autoCorrect="on"
                  autoComplete="email"
                  autoCapitalize="none"
                />
                <datalist id="other-accounts-email-suggestions">
                  {otherAccountsEmailSuggestions.map((email) => (
                    <option key={email} value={email} />
                  ))}
                </datalist>
              </div>
              <div
                className="inline-flex flex-wrap items-center gap-1.5 rounded-lg border border-border/70 bg-background/70 p-1.5"
                role="group"
                aria-label="Other accounts order"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={
                    otherAccountsSortMode === "available-first"
                      ? "secondary"
                      : "ghost"
                  }
                  className="h-9 rounded-md px-3.5 text-sm font-medium"
                  aria-pressed={otherAccountsSortMode === "available-first"}
                  onClick={() => {
                    setOtherAccountsSortMode("available-first");
                  }}
                >
                  Available first
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    otherAccountsSortMode === "usage-limit-available-first"
                      ? "secondary"
                      : "ghost"
                  }
                  className="h-9 rounded-md px-3.5 text-sm font-medium"
                  aria-pressed={
                    otherAccountsSortMode === "usage-limit-available-first"
                  }
                  onClick={() => {
                    setOtherAccountsSortMode("usage-limit-available-first");
                  }}
                >
                  Usage-limit soon available
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={
                    otherAccountsSortMode === "stable" ? "secondary" : "ghost"
                  }
                  className="h-9 rounded-md px-3.5 text-sm font-medium"
                  aria-pressed={otherAccountsSortMode === "stable"}
                  onClick={() => {
                    setOtherAccountsSortMode("stable");
                  }}
                >
                  Stable order
                </Button>
              </div>
            </div>
          </div>
          {filteredRemainingAccounts.length > 0 ? (
            renderGrid(filteredRemainingAccounts, "remaining")
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-dashed border-border/70 px-3 py-2">
              <p className="text-xs text-muted-foreground">
                No account email matched “{otherAccountsEmailSearch.trim()}”.
              </p>
              {hasOtherAccountsEmailSearch ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setOtherAccountsEmailSearch("");
                  }}
                >
                  Clear search
                </Button>
              ) : null}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
