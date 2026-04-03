import { useMemo } from "react";
import { Users } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { AccountCard, type AccountCardProps } from "@/features/dashboard/components/account-card";
import type { AccountSummary, UsageWindow } from "@/features/dashboard/schemas";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { isAccountWorkingNow } from "@/utils/account-working";
import { resolveEffectiveAccountStatus } from "@/utils/account-status";

function roundAveragePercent(values: Array<number | null | undefined>): number | null {
  const normalized = values
    .filter((value): value is number => value != null)
    .map((value) => Math.max(0, Math.min(100, value)));

  if (normalized.length === 0) {
    return null;
  }

  const average = normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
  return Math.round(average);
}

export type AccountCardsProps = {
  accounts: AccountSummary[];
  primaryWindow: UsageWindow | null;
  secondaryWindow: UsageWindow | null;
  useLocalBusy?: boolean;
  onAction?: AccountCardProps["onAction"];
};

function buildConsumedByAccount(window: UsageWindow | null): Map<string, number> {
  const consumedByAccount = new Map<string, number>();
  if (!window) return consumedByAccount;

  for (const row of window.accounts) {
    if (row.remainingPercentAvg == null) {
      continue;
    }
    consumedByAccount.set(row.accountId, Math.max(0, row.capacityCredits - row.remainingCredits));
  }

  return consumedByAccount;
}

function resolveCardTokensUsed(
  account: AccountSummary,
  primaryConsumedByAccount: Map<string, number>,
  secondaryConsumedByAccount: Map<string, number>,
): number {
  const weeklyOnly = account.windowMinutesPrimary == null && account.windowMinutesSecondary != null;
  const primaryConsumed = primaryConsumedByAccount.get(account.accountId);
  const secondaryConsumed = secondaryConsumedByAccount.get(account.accountId);

  if (weeklyOnly && secondaryConsumed != null) {
    return secondaryConsumed;
  }

  if (primaryConsumed != null) {
    return primaryConsumed;
  }

  if (secondaryConsumed != null) {
    return secondaryConsumed;
  }

  return account.requestUsage?.totalTokens ?? 0;
}

export function AccountCards({
  accounts,
  primaryWindow,
  secondaryWindow,
  useLocalBusy = false,
  onAction,
}: AccountCardsProps) {
  const duplicateAccountIds = useMemo(() => buildDuplicateAccountIdSet(accounts), [accounts]);
  const primaryConsumedByAccount = useMemo(() => buildConsumedByAccount(primaryWindow), [primaryWindow]);
  const secondaryConsumedByAccount = useMemo(() => buildConsumedByAccount(secondaryWindow), [secondaryWindow]);
  const groupedAccounts = useMemo(() => {
    const working: AccountSummary[] = [];
    const active: AccountSummary[] = [];
    const deactivated: AccountSummary[] = [];

    for (const account of accounts) {
      if (isAccountWorkingNow(account)) {
        working.push(account);
        continue;
      }

      const isDeactivated =
        resolveEffectiveAccountStatus({
          status: account.status,
          isActiveSnapshot: account.codexAuth?.isActiveSnapshot,
          hasLiveSession: account.codexAuth?.hasLiveSession,
        }) === "deactivated";

      if (isDeactivated) {
        deactivated.push(account);
      } else {
        active.push(account);
      }
    }

    return { working, remaining: [...active, ...deactivated] };
  }, [accounts]);
  const workingSummary = useMemo(() => {
    const liveSessions = groupedAccounts.working.reduce((sum, account) => {
      if (!account.codexAuth?.hasLiveSession) {
        return sum;
      }
      return sum + Math.max(account.codexSessionCount ?? 0, 1);
    }, 0);

    return {
      liveSessions,
      avgPrimaryRemaining: roundAveragePercent(
        groupedAccounts.working.map((account) => account.usage?.primaryRemainingPercent),
      ),
      avgSecondaryRemaining: roundAveragePercent(
        groupedAccounts.working.map((account) => account.usage?.secondaryRemainingPercent),
      ),
    };
  }, [groupedAccounts.working]);

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
          className="animate-fade-in-up"
          style={{ animationDelay: `${index * 60}ms` }}
        >
          <AccountCard
            account={account}
            tokensUsed={resolveCardTokensUsed(account, primaryConsumedByAccount, secondaryConsumedByAccount)}
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
      <section className="space-y-3 rounded-xl border border-cyan-500/25 bg-cyan-500/[0.04] p-3.5">
        <div className="flex flex-wrap items-start justify-between gap-2.5 px-0.5">
          <div className="space-y-1">
            <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-700 dark:text-cyan-300">
              Working now
            </h3>
            <p className="text-[11px] text-muted-foreground">
              Live accounts are grouped first so you can switch faster.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full border border-cyan-500/35 bg-cyan-500/10 px-1.5 text-[11px] font-semibold tabular-nums text-cyan-700 dark:text-cyan-300">
              {groupedAccounts.working.length}
            </span>
            {workingSummary.liveSessions > 0 ? (
              <span className="inline-flex items-center rounded-full border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                {workingSummary.liveSessions} live sessions
              </span>
            ) : null}
            {workingSummary.avgPrimaryRemaining !== null ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                5h avg {workingSummary.avgPrimaryRemaining}%
              </span>
            ) : null}
            {workingSummary.avgSecondaryRemaining !== null ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
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
