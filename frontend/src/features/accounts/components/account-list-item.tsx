import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { isEmailLabel } from "@/components/blur-email";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { StatusBadge } from "@/components/status-badge";
import type { AccountSummary } from "@/features/accounts/schemas";
import { normalizeStatus, quotaBarColor, quotaBarTrack } from "@/utils/account-status";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import { formatSlug } from "@/utils/formatters";

export type AccountListItemProps = {
  account: AccountSummary;
  selected: boolean;
  showAccountId?: boolean;
  onSelect: (accountId: string) => void;
  onUseLocal: (accountId: string) => void;
  useLocalBusy: boolean;
};

function MiniQuotaBar({ percent }: { percent: number | null }) {
  if (percent === null) {
    return <div data-testid="mini-quota-track" className="h-1 flex-1 overflow-hidden rounded-full bg-muted" />;
  }
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div data-testid="mini-quota-track" className={cn("h-1 flex-1 overflow-hidden rounded-full", quotaBarTrack(clamped))}>
      <div
        data-testid="mini-quota-fill"
        className={cn("h-full rounded-full", quotaBarColor(clamped))}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export function AccountListItem({
  account,
  selected,
  showAccountId = false,
  onSelect,
  onUseLocal,
  useLocalBusy,
}: AccountListItemProps) {
  const blurred = usePrivacyStore((s) => s.blurred);
  const status = normalizeStatus(account.status);
  const title = account.displayName || account.email;
  const titleIsEmail = isEmailLabel(title, account.email);
  const emailSubtitle = account.displayName && account.displayName !== account.email
    ? account.email
    : null;
  const baseSubtitle = emailSubtitle ?? formatSlug(account.planType);
  const idSuffix = showAccountId ? ` | ID ${formatCompactAccountId(account.accountId)}` : "";
  const secondary = account.usage?.secondaryRemainingPercent ?? null;
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
    <div
      className={cn(
        "w-full rounded-lg p-2 transition-colors",
        selected
          ? "bg-primary/8 ring-1 ring-primary/25"
          : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={() => onSelect(account.accountId)}
          className="min-w-0 flex-1 rounded-md px-1 py-0.5 text-left"
        >
          <div className="flex items-center gap-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {titleIsEmail && blurred ? <span className="privacy-blur">{title}</span> : title}
              </p>
              <p className="truncate text-xs text-muted-foreground" title={showAccountId ? `Account ID ${account.accountId}` : undefined}>
                {emailSubtitle ? <><span className={blurred ? "privacy-blur" : undefined}>{emailSubtitle}</span>{idSuffix}</> : <>{baseSubtitle}{idSuffix}</>}
              </p>
            </div>
            <StatusBadge status={status} />
          </div>
          <div className="mt-1.5">
            <MiniQuotaBar percent={secondary} />
          </div>
        </button>
        <div className="pt-0.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            className={
              canUseLocally
                ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-500 hover:text-white"
                : ""
            }
            disabled={!canUseLocally || useLocalBusy}
            title={disabledReason ?? undefined}
            onClick={() => onUseLocal(account.accountId)}
          >
            Use this
          </Button>
        </div>
      </div>
    </div>
  );
}
