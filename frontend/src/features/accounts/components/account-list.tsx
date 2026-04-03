import { ChevronDown, ChevronUp, Plus, Search, Upload } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AccountListItem } from "@/features/accounts/components/account-list-item";
import { WindowsOauthHelp } from "@/features/accounts/components/windows-oauth-help";
import type { AccountSummary } from "@/features/accounts/schemas";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { formatSlug } from "@/utils/formatters";
import { canUseLocalAccount } from "@/utils/use-local-account";

const STATUS_FILTER_OPTIONS = ["all", "active", "paused", "rate_limited", "quota_exceeded", "deactivated"];

function normalizeQuotaPercent(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : -1;
}

function compareAccountsForSidebar(a: AccountSummary, b: AccountSummary): number {
  const aCanUseLocally = canUseLocalAccount({
    status: a.status,
    primaryRemainingPercent: a.usage?.primaryRemainingPercent,
    isActiveSnapshot: a.codexAuth?.isActiveSnapshot,
    hasLiveSession: a.codexAuth?.hasLiveSession,
  });
  const bCanUseLocally = canUseLocalAccount({
    status: b.status,
    primaryRemainingPercent: b.usage?.primaryRemainingPercent,
    isActiveSnapshot: b.codexAuth?.isActiveSnapshot,
    hasLiveSession: b.codexAuth?.hasLiveSession,
  });

  if (aCanUseLocally !== bCanUseLocally) {
    return aCanUseLocally ? -1 : 1;
  }

  const aPrimary = normalizeQuotaPercent(a.usage?.primaryRemainingPercent);
  const bPrimary = normalizeQuotaPercent(b.usage?.primaryRemainingPercent);
  if (aPrimary !== bPrimary) {
    return bPrimary - aPrimary;
  }

  const aSecondary = normalizeQuotaPercent(a.usage?.secondaryRemainingPercent);
  const bSecondary = normalizeQuotaPercent(b.usage?.secondaryRemainingPercent);
  if (aSecondary !== bSecondary) {
    return bSecondary - aSecondary;
  }

  return a.email.localeCompare(b.email);
}

export type AccountListProps = {
  accounts: AccountSummary[];
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
  onUseLocal: (accountId: string) => void;
  useLocalBusy: boolean;
  onOpenImport: () => void;
  onOpenOauth: () => void;
};

export function AccountList({
  accounts,
  selectedAccountId,
  onSelect,
  onUseLocal,
  useLocalBusy,
  onOpenImport,
  onOpenOauth,
}: AccountListProps) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [helpOpen, setHelpOpen] = useState(false);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const filteredAccounts = accounts.filter((account) => {
      if (statusFilter !== "all" && account.status !== statusFilter) {
        return false;
      }
      if (!needle) {
        return true;
      }
      return (
        account.email.toLowerCase().includes(needle) ||
        account.accountId.toLowerCase().includes(needle) ||
        account.planType.toLowerCase().includes(needle)
      );
    });
    return filteredAccounts.sort(compareAccountsForSidebar);
  }, [accounts, search, statusFilter]);

  const duplicateAccountIds = useMemo(() => buildDuplicateAccountIdSet(accounts), [accounts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/60" aria-hidden />
          <Input
            placeholder="Search accounts..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="h-8 pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger size="sm" className="w-32 shrink-0">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option} value={option}>
                {option === "all" ? "All statuses" : formatSlug(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onOpenImport} className="h-8 flex-1 gap-1.5 text-xs">
          <Upload className="h-3.5 w-3.5" />
          Import
        </Button>
        <Button type="button" size="sm" onClick={onOpenOauth} className="h-8 flex-1 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          Add Account
        </Button>
      </div>

      <div>
        <Button
          type="button"
          variant="link"
          size="sm"
          className="h-auto px-0 text-xs"
          onClick={() => setHelpOpen((current) => !current)}
        >
          Need help?
          {helpOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {helpOpen ? <WindowsOauthHelp /> : null}

      <div className="max-h-[calc(100vh-16rem)] space-y-1 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-6 text-center">
            <p className="text-sm font-medium text-muted-foreground">No matching accounts</p>
            <p className="text-xs text-muted-foreground/70">Try adjusting your filters.</p>
          </div>
        ) : (
          filtered.map((account) => (
            <AccountListItem
              key={account.accountId}
              account={account}
              selected={account.accountId === selectedAccountId}
              showAccountId={duplicateAccountIds.has(account.accountId)}
              onSelect={onSelect}
              onUseLocal={onUseLocal}
              useLocalBusy={useLocalBusy}
            />
          ))
        )}
      </div>
    </div>
  );
}
