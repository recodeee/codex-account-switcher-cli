import { Pause, Play, RefreshCw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { AccountSummary } from "@/features/accounts/schemas";

export type AccountActionsProps = {
  account: AccountSummary;
  busy: boolean;
  useLocalBusy: boolean;
  onPause: (accountId: string) => void;
  onResume: (accountId: string) => void;
  onDelete: (accountId: string) => void;
  onUseLocal: (accountId: string) => void;
  onReauth: () => void;
};

export function AccountActions({
  account,
  busy,
  useLocalBusy,
  onPause,
  onResume,
  onDelete,
  onUseLocal,
  onReauth,
}: AccountActionsProps) {
  const hasFiveHourQuota = typeof account.usage?.primaryRemainingPercent === "number"
    && account.usage.primaryRemainingPercent > 0;
  const hasSnapshot = account.codexAuth?.hasSnapshot ?? false;
  const canUseLocally = hasFiveHourQuota && hasSnapshot;
  const disabledReason = !hasFiveHourQuota
    ? "No 5h quota remaining."
    : !hasSnapshot
      ? "No codex-auth snapshot found for this account."
      : null;

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

      {account.status === "deactivated" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 text-xs"
          onClick={onReauth}
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
