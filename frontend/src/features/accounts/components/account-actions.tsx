import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccountSummary } from "@/features/accounts/schemas";
import { canUseLocalAccount, getUseLocalAccountDisabledReason } from "@/utils/use-local-account";
import { resolveEffectiveAccountStatus } from "@/utils/account-status";
import { hasRecentUsageSignal } from "@/utils/account-working";

export type AccountActionsProps = {
  account: AccountSummary;
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

export function AccountActions({
  account,
  busy,
  useLocalBusy,
  repairSnapshotBusy = false,
  onPause,
  onResume,
  onDelete,
  onUseLocal,
  onRepairSnapshot,
  onReauth,
}: AccountActionsProps) {
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = account.codexAuth?.hasLiveSession ?? false;
  const recentUsageSignal =
    (account.codexAuth?.hasSnapshot ?? false) && hasRecentUsageSignal(account);
  const effectiveStatus = resolveEffectiveAccountStatus({
    status: account.status,
    isActiveSnapshot,
    hasLiveSession,
    hasRecentUsageSignal: recentUsageSignal,
  });
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: account.usage?.primaryRemainingPercent,
    isActiveSnapshot,
    hasLiveSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const disabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: account.usage?.primaryRemainingPercent,
    isActiveSnapshot,
    hasLiveSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const snapshotName = account.codexAuth?.snapshotName?.trim() ?? null;
  const expectedSnapshotName = account.codexAuth?.expectedSnapshotName?.trim() ?? null;
  const hasSnapshotMismatch = Boolean(
    snapshotName && expectedSnapshotName && snapshotName !== expectedSnapshotName,
  );

  return (
    <div className="flex flex-wrap gap-2 border-t pt-4">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className={
          canUseLocally
            ? "h-8 gap-1.5 border-emerald-600 bg-emerald-600 text-xs text-white hover:bg-emerald-500 hover:text-white"
            : "h-8 gap-1.5 text-xs"
        }
        disabled={!canUseLocally || useLocalBusy}
        title={disabledReason ?? undefined}
        onClick={() => onUseLocal(account.accountId)}
      >
        Use this
      </Button>
      {hasSnapshotMismatch ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={repairSnapshotBusy}
            onClick={() => onRepairSnapshot(account.accountId, "readd")}
          >
            Re-add snapshot
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            disabled={repairSnapshotBusy}
            onClick={() => onRepairSnapshot(account.accountId, "rename")}
          >
            Rename snapshot
          </Button>
        </>
      ) : null}

      {account.status === "paused" ? (
        <Button
          type="button"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onResume(account.accountId)}
          disabled={busy}
        >
          <Play className="h-3.5 w-3.5" />
          Resume
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onPause(account.accountId)}
          disabled={busy}
        >
          <Pause className="h-3.5 w-3.5" />
          Pause
        </Button>
      )}

      {effectiveStatus === "deactivated" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={() => onReauth(account.accountId)}
          disabled={busy}
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Re-authenticate
        </Button>
      ) : null}

      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="h-8 gap-1.5 text-xs"
        onClick={() => onDelete(account.accountId)}
        disabled={busy}
      >
        <Trash2 className="h-3.5 w-3.5" />
        Delete
      </Button>
    </div>
  );
}
