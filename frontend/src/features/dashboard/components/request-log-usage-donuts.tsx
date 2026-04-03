import { useMemo } from "react";

import { DonutChart } from "@/components/donut-chart";
import type { AccountSummary, RequestLogUsageSummary } from "@/features/dashboard/schemas";
import { buildDuplicateAccountIdSet, formatCompactAccountId } from "@/utils/account-identifiers";

export type RequestLogUsageDonutsProps = {
  accounts: AccountSummary[];
  usageSummary: RequestLogUsageSummary;
};

type DonutLegendItem = {
  id: string;
  label: string;
  labelSuffix: string;
  isEmail: boolean;
  value: number;
};

type UsageSummaryWindow = RequestLogUsageSummary["last5h"];

function buildDonutItems(accounts: AccountSummary[], window: UsageSummaryWindow): DonutLegendItem[] {
  const duplicateAccountIds = buildDuplicateAccountIdSet(accounts);
  const tokensByAccount = new Map<string, number>();
  let unassignedTokens = 0;

  for (const row of window.accounts) {
    if (!row.accountId) {
      unassignedTokens += row.tokens;
      continue;
    }
    tokensByAccount.set(row.accountId, row.tokens);
  }

  const items: DonutLegendItem[] = accounts.map((account) => {
    const rawLabel = account.displayName || account.email || account.accountId;
    const isEmail = !!account.email && rawLabel === account.email;
    const labelSuffix = duplicateAccountIds.has(account.accountId)
      ? ` (${formatCompactAccountId(account.accountId, 5, 4)})`
      : "";

    return {
      id: account.accountId,
      label: rawLabel,
      labelSuffix,
      isEmail,
      value: Math.max(0, tokensByAccount.get(account.accountId) ?? 0),
    };
  });

  const knownAccountIds = new Set(accounts.map((account) => account.accountId));
  const unknownRows = window.accounts
    .filter((row) => row.accountId && !knownAccountIds.has(row.accountId))
    .sort((left, right) => (left.accountId ?? "").localeCompare(right.accountId ?? ""));

  for (const row of unknownRows) {
    if (!row.accountId) continue;
    items.push({
      id: row.accountId,
      label: row.accountId,
      labelSuffix: "",
      isEmail: false,
      value: Math.max(0, row.tokens),
    });
  }

  if (unassignedTokens > 0) {
    items.push({
      id: "__unassigned__",
      label: "Unassigned",
      labelSuffix: "",
      isEmail: false,
      value: unassignedTokens,
    });
  }

  return items;
}

export function RequestLogUsageDonuts({ accounts, usageSummary }: RequestLogUsageDonutsProps) {
  const items5h = useMemo(
    () => buildDonutItems(accounts, usageSummary.last5h),
    [accounts, usageSummary.last5h],
  );

  const items7d = useMemo(
    () => buildDonutItems(accounts, usageSummary.last7d),
    [accounts, usageSummary.last7d],
  );

  const total5h = Math.max(
    usageSummary.last5h.totalTokens,
    items5h.reduce((total, item) => total + item.value, 0),
  );
  const total7d = Math.max(
    usageSummary.last7d.totalTokens,
    items7d.reduce((total, item) => total + item.value, 0),
  );

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <DonutChart
        title="5h Consumed"
        centerLabel="Consumed"
        items={items5h}
        total={total5h}
      />
      <DonutChart
        title="Weekly Consumed"
        centerLabel="Consumed"
        items={items7d}
        total={total7d}
      />
    </div>
  );
}
