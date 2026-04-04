import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isEmailLabel } from "@/components/blur-email";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { StatusBadge } from "@/components/status-badge";
import type { AccountSummary } from "@/features/accounts/schemas";

import {
  quotaBarColor,
  quotaBarTrack,
  resolveEffectiveAccountStatus,
} from "@/utils/account-status";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import { formatPercentNullable, formatSlug } from "@/utils/formatters";
import {
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  isAccountWorkingNow,
} from "@/utils/account-working";
import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";
import {
  canUseLocalAccount,
  getUseLocalAccountDisabledReason,
} from "@/utils/use-local-account";

export type AccountListItemProps = {
  account: AccountSummary;
  selected: boolean;
  showAccountId?: boolean;
  onSelect: (accountId: string) => void;
  onUseLocal: (accountId: string) => void;
  useLocalBusy: boolean;
};

function formatPlanWithSnapshot(
  planType: string,
  snapshotName?: string | null,
): string {
  const planLabel = formatSlug(planType);
  const normalizedSnapshotName = snapshotName?.trim();
  if (!normalizedSnapshotName) {
    return `${planLabel} · No snapshot`;
  }
  return `${planLabel} · ${normalizedSnapshotName}`;
}

function MiniQuotaRow({
  label,
  percent,
  testIdPrefix,
}: {
  label: string;
  percent: number | null;
  testIdPrefix: string;
}) {
  if (percent === null) {
    return (
      <div data-testid={`${testIdPrefix}-row`} className="space-y-1">
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>{label}</span>
          <span className="tabular-nums font-medium">{formatPercentNullable(percent)}</span>
        </div>
        <div
          data-testid={`${testIdPrefix}-track`}
          className="h-1 flex-1 overflow-hidden rounded-full bg-muted"
        />
      </div>
    );
  }
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div data-testid={`${testIdPrefix}-row`} className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>{label}</span>
        <span className="tabular-nums font-medium">{formatPercentNullable(percent)}</span>
      </div>
      <div
        data-testid={`${testIdPrefix}-track`}
        className={cn(
          "h-1 flex-1 overflow-hidden rounded-full",
          quotaBarTrack(clamped),
        )}
      >
        <div
          data-testid={`${testIdPrefix}-fill`}
          className={cn("h-full rounded-full", quotaBarColor(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
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
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = account.codexAuth?.hasLiveSession ?? false;
  const isWorkingNow = isAccountWorkingNow(account);
  const status = resolveEffectiveAccountStatus({
    status: account.status,
    isActiveSnapshot,
    hasLiveSession,
  });
  const title = account.displayName || account.email;
  const titleIsEmail = isEmailLabel(title, account.email);
  const emailSubtitle =
    account.displayName && account.displayName !== account.email
      ? account.email
      : null;
  const baseSubtitle =
    emailSubtitle ??
    formatPlanWithSnapshot(account.planType, account.codexAuth?.snapshotName);
  const idSuffix = showAccountId
    ? ` | ID ${formatCompactAccountId(account.accountId)}`
    : "";
  const mergedPrimaryRemainingPercent = getMergedQuotaRemainingPercent(account, "primary");
  const mergedSecondaryRemainingPercent = getMergedQuotaRemainingPercent(account, "secondary");
  const primaryRawQuotaFallback = getRawQuotaWindowFallback(account, "primary");
  const secondaryRawQuotaFallback = getRawQuotaWindowFallback(account, "secondary");
  const secondary = normalizeRemainingPercentForDisplay({
    accountKey: account.accountId,
    windowKey: "secondary",
    remainingPercent:
      mergedSecondaryRemainingPercent ??
      account.usage?.secondaryRemainingPercent ??
      secondaryRawQuotaFallback?.remainingPercent ??
      null,
    resetAt: account.resetAtSecondary ?? secondaryRawQuotaFallback?.resetAt ?? null,
    hasLiveSession,
    lastRecordedAt: account.lastUsageRecordedAtSecondary ?? secondaryRawQuotaFallback?.recordedAt ?? null,
    applyCycleFloor: mergedSecondaryRemainingPercent == null,
  });
  const primaryRemainingRaw =
    mergedPrimaryRemainingPercent ??
    account.usage?.primaryRemainingPercent ??
    primaryRawQuotaFallback?.remainingPercent ??
    null;
  const primaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: account.accountId,
    windowKey: "primary",
    remainingPercent: primaryRemainingRaw,
    resetAt: account.resetAtPrimary ?? primaryRawQuotaFallback?.resetAt ?? null,
    hasLiveSession,
    lastRecordedAt: account.lastUsageRecordedAtPrimary ?? primaryRawQuotaFallback?.recordedAt ?? null,
    applyCycleFloor: mergedPrimaryRemainingPercent == null,
  });
  const hasResolvedSnapshot = Boolean(account.codexAuth?.snapshotName?.trim());
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
    codexSessionCount: account.codexSessionCount,
  });
  const disabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
    codexSessionCount: account.codexSessionCount,
  });

  return (
    <div
      data-testid="account-list-item"
      className={cn(
        "w-full rounded-lg p-2 transition-colors",
        selected && isWorkingNow && "bg-cyan-500/12 ring-1 ring-cyan-500/35",
        selected && !isWorkingNow && "bg-primary/8 ring-1 ring-primary/25",
        !selected && isWorkingNow && "bg-cyan-500/[0.06] ring-1 ring-cyan-500/25 hover:bg-cyan-500/[0.1]",
        !selected && !isWorkingNow && "hover:bg-muted/50",
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
                {titleIsEmail && blurred ? (
                  <span className="privacy-blur">{title}</span>
                ) : (
                  title
                )}
              </p>
              <p
                className="truncate text-xs text-muted-foreground"
                title={
                  showAccountId ? `Account ID ${account.accountId}` : undefined
                }
              >
                {emailSubtitle ? (
                  <>
                    <span className={blurred ? "privacy-blur" : undefined}>
                      {emailSubtitle}
                    </span>
                    {idSuffix}
                  </>
                ) : (
                  <>
                    {baseSubtitle}
                    {idSuffix}
                  </>
                )}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <StatusBadge status={status} />
              {isWorkingNow ? (
                <Badge
                  data-testid="live-status-badge"
                  variant="outline"
                  className="h-5 gap-1.5 border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                  Live
                </Badge>
              ) : null}
              {!hasResolvedSnapshot ? (
                <Badge
                  data-testid="missing-snapshot-badge"
                  variant="destructive"
                  className="h-5 border-destructive/30 px-1.5 py-0 text-[10px]"
                >
                  No snapshot
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="mt-1.5 space-y-1.5">
            <MiniQuotaRow label="5h" percent={primaryRemaining ?? null} testIdPrefix="mini-quota-5h" />
            <MiniQuotaRow label="Weekly" percent={secondary} testIdPrefix="mini-quota-weekly" />
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
