import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import {
  AccountCard,
  type AccountCardProps,
} from "@/features/dashboard/components/account-card";
import type { AccountSummary, UsageWindow } from "@/features/dashboard/schemas";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import {
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  hasActiveCliSessionSignal,
  hasRecentUsageSignal,
  hasFreshLiveTelemetry,
  isAccountWorkingNow,
  selectStableRemainingPercent,
} from "@/utils/account-working";
import { resolveEffectiveAccountStatus } from "@/utils/account-status";
import { formatWindowLabel } from "@/utils/formatters";
import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";

const RECENT_LAST_SEEN_SORT_WINDOW_MS = 30 * 60 * 1000;

function roundAveragePercent(
  values: Array<number | null | undefined>,
): number | null {
  const normalized = values
    .filter((value): value is number => value != null)
    .map((value) => Math.max(0, Math.min(100, value)));

  if (normalized.length === 0) {
    return null;
  }

  const average =
    normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  return Math.round(average);
}

function compareNullableNumberDesc(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function compareNullableNumberAsc(left: number | null, right: number | null): number {
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

function resolveSortableRemainingPercent(
  account: AccountSummary,
  windowKey: "primary" | "secondary",
  nowMs: number,
): number | null {
  const mergedRemainingPercent = getMergedQuotaRemainingPercent(account, windowKey);
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

  const effectiveResetAt = deferredQuotaFallback?.resetAt ?? baselineResetAt ?? null;
  const effectiveRecordedAt =
    deferredQuotaFallback?.recordedAt ?? baselineRecordedAt ?? null;

  return normalizeRemainingPercentForDisplay({
    accountKey: account.accountId,
    windowKey,
    remainingPercent: remainingPercentRaw,
    resetAt: effectiveResetAt,
    hasLiveSession,
    lastRecordedAt: effectiveRecordedAt,
    applyCycleFloor: mergedRemainingPercent == null,
  });
}

function resolveSortableResetAtMs(
  account: AccountSummary,
  windowKey: "primary" | "secondary",
): number | null {
  const deferredQuotaFallback = getRawQuotaWindowFallback(account, windowKey);
  const baselineResetAt =
    windowKey === "primary" ? account.resetAtPrimary : account.resetAtSecondary;
  const effectiveResetAt = deferredQuotaFallback?.resetAt ?? baselineResetAt ?? null;
  return parseTimestampMs(effectiveResetAt);
}

function sortAccountsByAvailableQuota(
  accounts: AccountSummary[],
  nowMs: number,
): AccountSummary[] {
  const sortMetricsByAccountId = new Map(
    accounts.map((account) => [
      account.accountId,
      {
        primaryRemaining: resolveSortableRemainingPercent(
          account,
          "primary",
          nowMs,
        ),
        primaryResetAtMs: resolveSortableResetAtMs(account, "primary"),
        secondaryRemaining: resolveSortableRemainingPercent(
          account,
          "secondary",
          nowMs,
        ),
        title: account.displayName || account.email || account.accountId,
      },
    ]),
  );

  return [...accounts].sort((left, right) => {
    const leftMetrics = sortMetricsByAccountId.get(left.accountId);
    const rightMetrics = sortMetricsByAccountId.get(right.accountId);
    if (!leftMetrics || !rightMetrics) {
      return left.accountId.localeCompare(right.accountId);
    }

    const primaryDiff = compareNullableNumberDesc(
      leftMetrics.primaryRemaining,
      rightMetrics.primaryRemaining,
    );
    if (primaryDiff !== 0) return primaryDiff;

    const leftPrimaryDepleted =
      leftMetrics.primaryRemaining != null && leftMetrics.primaryRemaining <= 0;
    const rightPrimaryDepleted =
      rightMetrics.primaryRemaining != null && rightMetrics.primaryRemaining <= 0;
    if (leftPrimaryDepleted && rightPrimaryDepleted) {
      const primaryResetDiff = compareNullableNumberAsc(
        leftMetrics.primaryResetAtMs,
        rightMetrics.primaryResetAtMs,
      );
      if (primaryResetDiff !== 0) return primaryResetDiff;
    }

    const secondaryDiff = compareNullableNumberDesc(
      leftMetrics.secondaryRemaining,
      rightMetrics.secondaryRemaining,
    );
    if (secondaryDiff !== 0) return secondaryDiff;

    return leftMetrics.title.localeCompare(rightMetrics.title);
  });
}

function resolveMostRecentUsageRecordedAtMs(account: AccountSummary): number | null {
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

  return Math.max(primaryRecordedAtMs ?? Number.NEGATIVE_INFINITY, secondaryRecordedAtMs ?? Number.NEGATIVE_INFINITY);
}

function hasRecentLastSeenUsage(
  account: AccountSummary,
  nowMs: number = Date.now(),
): boolean {
  const mostRecentUsageRecordedAtMs = resolveMostRecentUsageRecordedAtMs(account);
  if (mostRecentUsageRecordedAtMs == null) {
    return false;
  }
  return nowMs - mostRecentUsageRecordedAtMs <= RECENT_LAST_SEEN_SORT_WINDOW_MS;
}

function sortAccountsByLastSeenAndAvailableQuota(
  accounts: AccountSummary[],
  nowMs: number = Date.now(),
): AccountSummary[] {
  const recentAccounts: AccountSummary[] = [];
  const staleAccounts: AccountSummary[] = [];

  for (const account of accounts) {
    if (hasRecentLastSeenUsage(account, nowMs)) {
      recentAccounts.push(account);
    } else {
      staleAccounts.push(account);
    }
  }

  return [
    ...sortAccountsByAvailableQuota(recentAccounts, nowMs),
    ...sortAccountsByAvailableQuota(staleAccounts, nowMs),
  ];
}

export type AccountCardsProps = {
  accounts: AccountSummary[];
  primaryWindow: UsageWindow | null;
  secondaryWindow: UsageWindow | null;
  useLocalBusy?: boolean;
  onAction?: AccountCardProps["onAction"];
};

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
  useLocalBusy = false,
  onAction,
}: AccountCardsProps) {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
      });

      if (isAccountWorkingNow(account, nowMs)) {
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
      working: sortAccountsByAvailableQuota(working, nowMs),
      remaining: [
        ...sortAccountsByLastSeenAndAvailableQuota(active, nowMs),
        ...sortAccountsByLastSeenAndAvailableQuota(deactivated, nowMs),
      ],
    };
  }, [accounts, nowMs]);
  const workingSummary = useMemo(() => {
    const liveSessions = groupedAccounts.working.reduce((sum, account) => {
      if (!hasFreshLiveTelemetry(account, nowMs)) {
        return sum;
      }
      return sum + Math.max(account.codexLiveSessionCount ?? 0, 1);
    }, 0);

    return {
      liveSessions,
      avgPrimaryRemaining: roundAveragePercent(
        groupedAccounts.working.map((account) =>
          normalizeRemainingPercentForDisplay({
            accountKey: account.accountId,
            windowKey: "primary",
            remainingPercent: account.usage?.primaryRemainingPercent ?? null,
            resetAt: account.resetAtPrimary ?? null,
            hasLiveSession: hasFreshLiveTelemetry(account, nowMs),
            lastRecordedAt: account.lastUsageRecordedAtPrimary ?? null,
          }),
        ),
      ),
      avgSecondaryRemaining: roundAveragePercent(
        groupedAccounts.working.map((account) =>
          normalizeRemainingPercentForDisplay({
            accountKey: account.accountId,
            windowKey: "secondary",
            remainingPercent: account.usage?.secondaryRemainingPercent ?? null,
            resetAt: account.resetAtSecondary ?? null,
            hasLiveSession: hasFreshLiveTelemetry(account, nowMs),
            lastRecordedAt: account.lastUsageRecordedAtSecondary ?? null,
          }),
        ),
      ),
    };
  }, [groupedAccounts.working, nowMs]);

  if (accounts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No accounts connected yet"
        description="Import or authenticate an account to get started."
      />
    );
  }

  const renderGrid = (items: AccountSummary[], keyPrefix: string) => (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((account, index) => (
        <div
          key={`${keyPrefix}-${account.accountId}`}
          className={
            keyPrefix === "working"
              ? "animate-working-account-enter"
              : "animate-fade-in-up"
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
            useLocalBusy={useLocalBusy}
            onAction={onAction}
          />
        </div>
      ))}
    </div>
  );

  if (groupedAccounts.working.length === 0) {
    return renderGrid(groupedAccounts.remaining, "all");
  }

  return (
    <div className="space-y-5">
      <section className="space-y-4 rounded-2xl border border-cyan-500/25 bg-cyan-500/[0.04] p-4 md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-cyan-700 dark:text-cyan-300">
              Working now
            </h3>
            <p className="text-xs text-muted-foreground">
              Accounts with active CLI sessions are grouped first so you can
              switch faster.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <span className="inline-flex items-center rounded-full border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold tabular-nums text-cyan-700 dark:text-cyan-300">
              {groupedAccounts.working.length} working
            </span>
            {workingSummary.liveSessions > 0 ? (
              <span className="inline-flex items-center rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-cyan-700 dark:text-cyan-300">
                {workingSummary.liveSessions} live sessions
              </span>
            ) : null}
            {workingSummary.avgPrimaryRemaining !== null ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-700 dark:text-emerald-300">
                {primaryWindowLabel} avg {workingSummary.avgPrimaryRemaining}%
              </span>
            ) : null}
            {workingSummary.avgSecondaryRemaining !== null ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold tracking-wide text-emerald-700 dark:text-emerald-300">
                Weekly avg {workingSummary.avgSecondaryRemaining}%
              </span>
            ) : null}
          </div>
        </div>
        {renderGrid(groupedAccounts.working, "working")}
      </section>

      {groupedAccounts.remaining.length > 0 ? (
        <section className="space-y-2.5">
          <div className="flex items-center gap-2.5 px-0.5">
            <h3 className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Other accounts
            </h3>
            <div className="h-px flex-1 bg-border/70" />
          </div>
          {renderGrid(groupedAccounts.remaining, "remaining")}
        </section>
      ) : null}
    </div>
  );
}
