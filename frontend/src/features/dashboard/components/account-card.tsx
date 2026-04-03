import { Clock, ExternalLink, Play, RotateCcw, SquareTerminal } from "lucide-react";

import { usePrivacyStore } from "@/hooks/use-privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/features/dashboard/schemas";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import {
  quotaBarColor,
  quotaBarTrack,
  resolveEffectiveAccountStatus,
} from "@/utils/account-status";
import {
  formatLastUsageLabel,
  formatPercentNullable,
  formatQuotaResetLabel,
  formatTokenCredits,
  formatSlug,
} from "@/utils/formatters";
import { resolveCodexSessionCount } from "@/utils/codex-sessions";
import { canUseLocalAccount, getUseLocalAccountDisabledReason } from "@/utils/use-local-account";

type AccountAction = "details" | "resume" | "reauth" | "terminal" | "useLocal" | "sessions";

export type AccountCardProps = {
  account: AccountSummary;
  tokensUsed?: number | null;
  showAccountId?: boolean;
  useLocalBusy?: boolean;
  onAction?: (account: AccountSummary, action: AccountAction) => void;
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

function QuotaBar({
  label,
  percent,
  resetLabel,
  lastSeenLabel,
}: {
  label: string;
  percent: number | null;
  resetLabel: string;
  lastSeenLabel?: string | null;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const hasPercent = percent !== null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            "tabular-nums font-medium",
            !hasPercent
              ? "text-muted-foreground"
              : clamped >= 70
                ? "text-emerald-600 dark:text-emerald-400"
                : clamped >= 30
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-red-600 dark:text-red-400",
          )}
        >
          {formatPercentNullable(percent)}
        </span>
      </div>
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", quotaBarTrack(clamped))}>
        <div
          className={cn("h-full rounded-full transition-all duration-500 ease-out", quotaBarColor(clamped))}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{resetLabel}</span>
      </div>
      {lastSeenLabel ? <div className="text-[11px] text-muted-foreground">{lastSeenLabel}</div> : null}
    </div>
  );
}

export function AccountCard({
  account,
  tokensUsed = null,
  showAccountId = false,
  useLocalBusy = false,
  onAction,
}: AccountCardProps) {
  const blurred = usePrivacyStore((s) => s.blurred);
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = account.codexAuth?.hasLiveSession ?? false;
  const isWorkingNow = hasLiveSession || isActiveSnapshot;
  const status = resolveEffectiveAccountStatus({
    status: account.status,
    isActiveSnapshot,
    hasLiveSession,
  });
  const primaryRemaining = account.usage?.primaryRemainingPercent ?? null;
  const secondaryRemaining = account.usage?.secondaryRemainingPercent ?? null;
  const weeklyOnly = account.windowMinutesPrimary == null && account.windowMinutesSecondary != null;
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    isActiveSnapshot,
  });
  const useLocalDisabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    isActiveSnapshot,
  });

  const primaryReset = formatQuotaResetLabel(account.resetAtPrimary ?? null);
  const secondaryReset = formatQuotaResetLabel(account.resetAtSecondary ?? null);
  const showLastSeen = account.status === "deactivated";
  const primaryLastSeen = showLastSeen
    ? formatLastUsageLabel(account.lastUsageRecordedAtPrimary ?? null)
    : null;
  const secondaryLastSeen = showLastSeen
    ? formatLastUsageLabel(account.lastUsageRecordedAtSecondary ?? null)
    : null;

  const title = account.displayName || account.email;
  const compactId = formatCompactAccountId(account.accountId);
  const planWithSnapshot = formatPlanWithSnapshot(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const totalTokensUsed = tokensUsed ?? account.requestUsage?.totalTokens ?? 0;
  const codexSessionCount = resolveCodexSessionCount(account.codexSessionCount, isWorkingNow);
  const emailSubtitle =
    account.displayName && account.displayName !== account.email
      ? account.email
      : null;
  const idSuffix = showAccountId ? ` | ID ${compactId}` : "";

  return (
    <div className="card-hover rounded-xl border bg-card p-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {blurred
              ? <span className="privacy-blur">{title}</span>
              : title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {planWithSnapshot}
            {!emailSubtitle ? idSuffix : ""}
          </p>
          {emailSubtitle ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={showAccountId ? `Account ID ${account.accountId}` : undefined}>
              <span className={blurred ? "privacy-blur" : undefined}>{emailSubtitle}</span>{showAccountId ? ` | ID ${compactId}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={status} />
          {isWorkingNow ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              Working now
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-border/70 bg-muted/20 px-2.5 py-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Tokens used</p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums">{formatTokenCredits(totalTokensUsed)}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Codex sessions</p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums">{codexSessionCount}</p>
        </div>
      </div>

      {/* Quota bars */}
      <div className={cn("mt-3.5 grid gap-3", weeklyOnly ? "grid-cols-1" : "grid-cols-2")}>
        {!weeklyOnly && (
          <QuotaBar
            label="5h"
            percent={primaryRemaining}
            resetLabel={primaryReset}
            lastSeenLabel={primaryLastSeen}
          />
        )}
        <QuotaBar
          label="Weekly"
          percent={secondaryRemaining}
          resetLabel={secondaryReset}
          lastSeenLabel={secondaryLastSeen}
        />
      </div>

      {/* Actions */}
      <div className="mt-3 flex items-center gap-1.5 border-t pt-3">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn(
            "h-7 gap-1.5 rounded-lg text-xs",
            canUseLocally
              ? "text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
              : "text-muted-foreground",
          )}
          disabled={!canUseLocally || useLocalBusy}
          title={useLocalDisabledReason ?? undefined}
          onClick={() => onAction?.(account, "useLocal")}
        >
          Use this account
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-lg text-xs text-cyan-700 hover:bg-cyan-500/10 hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
          disabled={!canUseLocally || useLocalBusy}
          title={useLocalDisabledReason ?? undefined}
          onClick={() => onAction?.(account, "terminal")}
        >
          <SquareTerminal className="h-3 w-3" />
          Terminal
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onAction?.(account, "details")}
        >
          <ExternalLink className="h-3 w-3" />
          Details
        </Button>
        {codexSessionCount > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-cyan-700 hover:bg-cyan-500/10 hover:text-cyan-800 dark:text-cyan-300 dark:hover:text-cyan-200"
            onClick={() => onAction?.(account, "sessions")}
          >
            <ExternalLink className="h-3 w-3" />
            Sessions
          </Button>
        ) : null}
        {status === "paused" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
            onClick={() => onAction?.(account, "resume")}
          >
            <Play className="h-3 w-3" />
            Resume
          </Button>
        )}
        {status === "deactivated" && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 rounded-lg text-xs text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
            onClick={() => onAction?.(account, "reauth")}
          >
            <RotateCcw className="h-3 w-3" />
            Re-auth
          </Button>
        )}
      </div>
    </div>
  );
}
