import { User } from "lucide-react";

import { isEmailLabel } from "@/components/blur-email";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { AccountActions } from "@/features/accounts/components/account-actions";
import { AccountSnapshotTutorial } from "@/features/accounts/components/account-snapshot-tutorial";
import { AccountTokenInfo } from "@/features/accounts/components/account-token-info";
import { AccountUsagePanel } from "@/features/accounts/components/account-usage-panel";
import type { AccountSummary } from "@/features/accounts/schemas";
import { useAccountTrends } from "@/features/accounts/hooks/use-accounts";
import { formatCompactAccountId } from "@/utils/account-identifiers";

export type AccountDetailProps = {
  account: AccountSummary | null;
  showAccountId?: boolean;
  busy: boolean;
  useLocalBusy: boolean;
  repairSnapshotBusy?: boolean;
  onPause: (accountId: string) => void;
  onResume: (accountId: string) => void;
  onDelete: (accountId: string) => void;
  onUseLocal: (accountId: string) => void;
  onRepairSnapshot: (accountId: string, mode: "readd" | "rename") => void;
  onReauth: (accountId: string) => void;
};

export function AccountDetail({
  account,
  showAccountId = false,
  busy,
  useLocalBusy,
  repairSnapshotBusy = false,
  onPause,
  onResume,
  onDelete,
  onUseLocal,
  onRepairSnapshot,
  onReauth,
}: AccountDetailProps) {
  const { data: trends } = useAccountTrends(account?.accountId ?? null);
  const blurred = usePrivacyStore((s) => s.blurred);

  if (!account) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed p-12">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <User className="h-5 w-5 text-muted-foreground" />
        </div>
        <p className="mt-3 text-sm font-medium text-muted-foreground">Select an account</p>
        <p className="mt-1 text-xs text-muted-foreground/70">Choose an account from the list to view details.</p>
      </div>
    );
  }

  const title = account.displayName || account.email;
  const titleIsEmail = isEmailLabel(title, account.email);
  const compactId = formatCompactAccountId(account.accountId);
  const emailSubtitle = account.displayName && account.displayName !== account.email
    ? account.email
    : null;
  const idSuffix = showAccountId ? ` (${compactId})` : "";
  const hasResolvedSnapshot = Boolean(account.codexAuth?.snapshotName?.trim());
  const snapshotName = account.codexAuth?.snapshotName?.trim() || null;

  return (
    <div key={account.accountId} className="animate-fade-in-up space-y-4 rounded-xl border bg-card p-5">
      {/* Account header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">
            {titleIsEmail ? <><span className={blurred ? "privacy-blur" : ""}>{title}</span>{idSuffix}</> : <>{title}{!emailSubtitle ? idSuffix : ""}</>}
          </h2>
          {snapshotName ? (
            <span className="inline-flex items-center rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-cyan-700 dark:text-cyan-300">
              SNAPSHOT:{snapshotName}
            </span>
          ) : null}
        </div>
        {emailSubtitle ? (
          <p className="mt-0.5 text-xs text-muted-foreground" title={showAccountId ? `Account ID ${account.accountId}` : undefined}>
            <span className={blurred ? "privacy-blur" : ""}>{emailSubtitle}</span>{showAccountId ? ` | ID ${compactId}` : ""}
          </p>
        ) : null}
      </div>

      {!hasResolvedSnapshot ? <AccountSnapshotTutorial /> : null}
      <AccountUsagePanel account={account} trends={trends} />
      <AccountTokenInfo account={account} />
      <AccountActions
        account={account}
        busy={busy}
        useLocalBusy={useLocalBusy}
        repairSnapshotBusy={repairSnapshotBusy}
        onPause={onPause}
        onResume={onResume}
        onDelete={onDelete}
        onUseLocal={onUseLocal}
        onRepairSnapshot={onRepairSnapshot}
        onReauth={onReauth}
      />
    </div>
  );
}
