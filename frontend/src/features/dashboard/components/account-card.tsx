import {
  Activity,
  Clock,
  ExternalLink,
  Play,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";

import { usePrivacyStore } from "@/hooks/use-privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/features/dashboard/schemas";
import { formatCompactAccountId } from "@/utils/account-identifiers";
import {
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
import { isAccountWorkingNow } from "@/utils/account-working";
import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";
import {
  canUseLocalAccount,
  getUseLocalAccountDisabledReason,
} from "@/utils/use-local-account";

type AccountAction =
  | "details"
  | "resume"
  | "reauth"
  | "terminal"
  | "useLocal"
  | "sessions";

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
  deactivated = false,
  isLive = false,
}: {
  label: string;
  percent: number | null;
  resetLabel: string;
  lastSeenLabel?: string | null;
  deactivated?: boolean;
  isLive?: boolean;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const hasPercent = percent !== null;
  const tone = deactivated
    ? "deactivated"
    : !hasPercent
      ? "unknown"
      : clamped >= 70
        ? "healthy"
        : clamped >= 30
          ? "warning"
          : "critical";

  const percentPillClass = cn(
    "rounded-md border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
    isLive && !deactivated && "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
    tone === "healthy" &&
      "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    tone === "warning" &&
      "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    tone === "critical" &&
      "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-300",
    tone === "deactivated" &&
      "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
    tone === "unknown" && "border-border/70 bg-muted/35 text-muted-foreground",
  );

  const fillClass = cn(
    "h-full rounded-full transition-[width,opacity] duration-500 ease-out",
    isLive && "duration-300",
    tone === "healthy" &&
      "bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-400 shadow-[0_0_12px_rgba(16,185,129,0.35)]",
    tone === "warning" &&
      "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300 shadow-[0_0_12px_rgba(245,158,11,0.32)]",
    tone === "critical" &&
      "bg-gradient-to-r from-rose-600 via-red-500 to-orange-400 shadow-[0_0_12px_rgba(239,68,68,0.32)]",
    tone === "deactivated" &&
      "bg-gradient-to-r from-zinc-500/80 via-zinc-400/70 to-zinc-300/65 shadow-none",
    tone === "unknown" && "bg-muted-foreground/45",
  );

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/60 bg-background/30 px-2.5 py-2.5",
        isLive && !deactivated && "border-cyan-500/35 bg-cyan-500/[0.08]",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          {isLive && !deactivated ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />
              Live
            </span>
          ) : null}
          <span className={percentPillClass}>
            {formatPercentNullable(percent)}
          </span>
        </div>
      </div>
      <div
        className={cn(
          "relative h-2 w-full overflow-hidden rounded-full ring-1 ring-white/5",
          tone === "deactivated" ? "bg-zinc-500/10" : quotaBarTrack(clamped),
        )}
      >
        <div className={fillClass} style={{ width: `${clamped}%` }} />
        {isLive && !deactivated ? (
          <div className="absolute inset-y-0 right-0 w-2 animate-pulse bg-white/45" />
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{resetLabel}</span>
      </div>
      {isLive && !deactivated ? (
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
          <Activity className="h-3 w-3 animate-pulse" />
          <span>Live token status</span>
        </div>
      ) : null}
      {lastSeenLabel ? (
        <div className="text-[11px] text-muted-foreground">{lastSeenLabel}</div>
      ) : null}
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
  const isWorkingNow = isAccountWorkingNow(account);
  const status = resolveEffectiveAccountStatus({
    status: account.status,
    isActiveSnapshot,
    hasLiveSession,
  });
  const primaryRemainingRaw = account.usage?.primaryRemainingPercent ?? null;
  const primaryRemaining = normalizeRemainingPercentForDisplay({
    windowKey: "primary",
    remainingPercent: primaryRemainingRaw,
    resetAt: account.resetAtPrimary ?? null,
  });
  const secondaryRemaining = account.usage?.secondaryRemainingPercent ?? null;
  const weeklyOnly =
    account.windowMinutesPrimary == null &&
    account.windowMinutesSecondary != null;
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
  });
  const useLocalDisabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
  });

  const primaryReset = formatQuotaResetLabel(account.resetAtPrimary ?? null);
  const secondaryReset = formatQuotaResetLabel(
    account.resetAtSecondary ?? null,
  );
  const isDeactivated = status === "deactivated";
  const primaryLastSeen = formatLastUsageLabel(account.lastUsageRecordedAtPrimary ?? null);
  const secondaryLastSeen = formatLastUsageLabel(account.lastUsageRecordedAtSecondary ?? null);
  const stalePrimaryLastSeen = !hasLiveSession ? primaryLastSeen : null;
  const staleSecondaryLastSeen = !hasLiveSession ? secondaryLastSeen : null;
  const deactivatedLastSeenLabel =
    isDeactivated && (primaryLastSeen || secondaryLastSeen)
      ? primaryLastSeen ?? secondaryLastSeen
      : null;

  const title = account.displayName || account.email;
  const compactId = formatCompactAccountId(account.accountId);
  const planWithSnapshot = formatPlanWithSnapshot(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const totalTokensUsed = tokensUsed ?? account.requestUsage?.totalTokens ?? 0;
  const codexSessionCount = hasLiveSession
    ? Math.max(account.codexSessionCount ?? 0, 1)
    : 0;
  const emailSubtitle =
    account.displayName && account.displayName !== account.email
      ? account.email
      : null;
  const idSuffix = showAccountId ? ` | ID ${compactId}` : "";

  return (
    <div className="card-hover rounded-xl border border-border/70 bg-gradient-to-b from-card to-card/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {blurred ? <span className="privacy-blur">{title}</span> : title}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {planWithSnapshot}
            {!emailSubtitle ? idSuffix : ""}
          </p>
          {emailSubtitle ? (
            <p
              className="mt-0.5 truncate text-xs text-muted-foreground"
              title={
                showAccountId ? `Account ID ${account.accountId}` : undefined
              }
            >
              <span className={blurred ? "privacy-blur" : undefined}>
                {emailSubtitle}
              </span>
              {showAccountId ? ` | ID ${compactId}` : ""}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5">
          <StatusBadge status={status} />
          {deactivatedLastSeenLabel ? (
            <Badge
              variant="outline"
              className="gap-1 border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300"
              title={deactivatedLastSeenLabel}
            >
              <Clock className="h-3 w-3" />
              {deactivatedLastSeenLabel}
            </Badge>
          ) : null}
          {isWorkingNow ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              Working now
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-lg border border-border/60 bg-background/35 px-2.5 py-2">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Tokens used
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold tabular-nums">
            <span>{formatTokenCredits(totalTokensUsed)}</span>
            {isWorkingNow ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                live
              </span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Codex CLI sessions
          </p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums">
            {codexSessionCount}
          </p>
        </div>
      </div>

      {/* Quota bars */}
      <div
        className={cn(
          "mt-3.5 grid gap-2.5",
          weeklyOnly ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {!weeklyOnly && (
          <QuotaBar
            label="5h"
            percent={primaryRemaining}
            resetLabel={primaryReset}
            lastSeenLabel={stalePrimaryLastSeen}
            deactivated={isDeactivated}
            isLive={hasLiveSession}
          />
        )}
        <QuotaBar
          label="Weekly"
          percent={secondaryRemaining}
          resetLabel={secondaryReset}
          lastSeenLabel={staleSecondaryLastSeen}
          isLive={hasLiveSession}
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
