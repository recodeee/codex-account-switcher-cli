import {
  Activity,
  ChevronDown,
  Clock,
  ExternalLink,
  Play,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { useMemo, useState } from "react";

import { CopyButton } from "@/components/copy-button";
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
  formatTokenUsageCompact,
  formatTokenUsagePrecise,
  formatWindowLabel,
  formatSlug,
} from "@/utils/formatters";
import {
  getFreshDebugRawSampleCount,
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  hasFreshLiveTelemetry,
  isAccountWorkingNow,
  isFreshQuotaTelemetryTimestamp,
  selectStableRemainingPercent,
} from "@/utils/account-working";
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
  | "sessions"
  | "repairSnapshotReadd"
  | "repairSnapshotRename";

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
  lastSeenUpToDate = false,
  deactivated = false,
  isLive = false,
  telemetryPending = false,
}: {
  label: string;
  percent: number | null;
  resetLabel: string;
  lastSeenLabel?: string | null;
  lastSeenUpToDate?: boolean;
  deactivated?: boolean;
  isLive?: boolean;
  telemetryPending?: boolean;
}) {
  const clamped = percent === null ? 0 : Math.max(0, Math.min(100, percent));
  const hasPercent = percent !== null;
  const liveTelemetryUnavailable = isLive && !deactivated && percent === null;
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
    isLive &&
      !deactivated &&
      "border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
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
      "bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-400",
    tone === "warning" &&
      "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300",
    tone === "critical" &&
      "bg-gradient-to-r from-rose-600 via-red-500 to-orange-400",
    tone === "deactivated" &&
      "bg-gradient-to-r from-zinc-500/80 via-zinc-400/70 to-zinc-300/65 shadow-none",
    tone === "unknown" && "bg-muted-foreground/45",
  );

  return (
    <div
      className={cn(
        "space-y-2 rounded-lg border border-border/55 bg-background/20 px-2.5 py-2.5",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-semibold text-muted-foreground">{label}</span>
        <div className="flex items-center gap-1.5">
          {isLive && !deactivated ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
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
          tone === "deactivated"
            ? "bg-zinc-500/10"
            : tone === "unknown"
              ? "bg-muted/40"
              : quotaBarTrack(clamped),
        )}
      >
        <div className={fillClass} style={{ width: `${clamped}%` }} />
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Clock className="h-3 w-3 shrink-0" />
        <span>{resetLabel}</span>
      </div>
      <div className="min-h-[16px]">
        {isLive && !deactivated ? (
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
            <Activity className="h-3 w-3" />
            <span>
              {telemetryPending
                ? "Telemetry pending"
                : liveTelemetryUnavailable
                  ? "Live session detected"
                  : "Live token status"}
            </span>
          </div>
        ) : lastSeenLabel ? (
          <div
            className={cn(
              "text-[11px]",
              lastSeenUpToDate
                ? "font-medium text-emerald-600 dark:text-emerald-300"
                : "text-muted-foreground",
            )}
          >
            {lastSeenLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function resolveLastSeenDisplay(label: string | null | undefined): {
  label: string | null;
  upToDate: boolean;
} {
  if (!label) {
    return { label: null, upToDate: false };
  }
  const normalized = label.trim().toLowerCase();
  const upToDate =
    normalized === "last seen now" || /\b0m ago$/.test(normalized);
  if (upToDate) {
    return { label: "Up to date", upToDate: true };
  }
  return { label, upToDate: false };
}

function formatDebugPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) {
    return "—";
  }
  return `${Math.round(value)}%`;
}

function formatDebugSource(source: string): string {
  const normalized = source.trim();
  if (!normalized) {
    return "unknown";
  }
  const parts = normalized.split("/");
  return parts[parts.length - 1] || normalized;
}

function buildQuotaDebugLogLines(
  liveQuotaDebug: NonNullable<AccountSummary["liveQuotaDebug"]>,
): string[] {
  const merged = liveQuotaDebug.merged;
  const lines: string[] = [
    `$ merged 5h=${formatDebugPercent(merged?.primary?.remainingPercent)} weekly=${formatDebugPercent(merged?.secondary?.remainingPercent)}`,
    `$ override=${liveQuotaDebug.overrideReason ?? (liveQuotaDebug.overrideApplied ? "applied" : "none")}`,
    `$ flow=collect_raw -> merge -> ${liveQuotaDebug.overrideApplied ? "apply_override" : "no_override"}`,
  ];

  if (liveQuotaDebug.snapshotsConsidered.length > 0) {
    lines.push(`$ snapshots=${liveQuotaDebug.snapshotsConsidered.join(", ")}`);
  }

  if (liveQuotaDebug.rawSamples.length === 0) {
    lines.push("$ no raw terminal samples");
    return lines;
  }

  liveQuotaDebug.rawSamples.slice(0, 24).forEach((sample, index) => {
    const staleSuffix = sample.stale ? " stale=true" : "";
    const snapshotSuffix = sample.snapshotName
      ? ` snapshot=${sample.snapshotName}`
      : "";
    lines.push(
      `$ sample#${index + 1} src=${formatDebugSource(sample.source)} 5h=${formatDebugPercent(sample.primary?.remainingPercent)} weekly=${formatDebugPercent(sample.secondary?.remainingPercent)}${snapshotSuffix}${staleSuffix}`,
    );
  });
  return lines;
}

export function AccountCard({
  account,
  tokensUsed = null,
  showAccountId = false,
  useLocalBusy = false,
  onAction,
}: AccountCardProps) {
  const [showQuotaDebug, setShowQuotaDebug] = useState(false);
  const liveQuotaDebug = account.liveQuotaDebug ?? null;
  const mergedPrimaryRemainingPercent = getMergedQuotaRemainingPercent(
    account,
    "primary",
  );
  const mergedSecondaryRemainingPercent = getMergedQuotaRemainingPercent(
    account,
    "secondary",
  );
  const deferredPrimaryQuotaFallback = getRawQuotaWindowFallback(
    account,
    "primary",
  );
  const deferredSecondaryQuotaFallback = getRawQuotaWindowFallback(
    account,
    "secondary",
  );
  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account);
  const blurred = usePrivacyStore((s) => s.blurred);
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = hasFreshLiveTelemetry(account);
  const isWorkingNow = isAccountWorkingNow(account);
  const effectiveStatus = resolveEffectiveAccountStatus({
    status: account.status,
    isActiveSnapshot,
    hasLiveSession,
  });
  const status = effectiveStatus;
  const primaryRemainingRaw =
    mergedPrimaryRemainingPercent ??
    selectStableRemainingPercent({
      fallbackRemainingPercent: deferredPrimaryQuotaFallback?.remainingPercent,
      fallbackResetAt: deferredPrimaryQuotaFallback?.resetAt,
      baselineRemainingPercent: account.usage?.primaryRemainingPercent,
      baselineResetAt: account.resetAtPrimary,
    });
  const secondaryRemainingRaw =
    mergedSecondaryRemainingPercent ??
    selectStableRemainingPercent({
      fallbackRemainingPercent: deferredSecondaryQuotaFallback?.remainingPercent,
      fallbackResetAt: deferredSecondaryQuotaFallback?.resetAt,
      baselineRemainingPercent: account.usage?.secondaryRemainingPercent,
      baselineResetAt: account.resetAtSecondary,
    });
  const primaryLastRecordedAt =
    deferredPrimaryQuotaFallback?.recordedAt ??
    account.lastUsageRecordedAtPrimary ??
    null;
  const secondaryLastRecordedAt =
    deferredSecondaryQuotaFallback?.recordedAt ??
    account.lastUsageRecordedAtSecondary ??
    null;
  const primaryResetAt =
    deferredPrimaryQuotaFallback?.resetAt ?? account.resetAtPrimary ?? null;
  const secondaryResetAt =
    deferredSecondaryQuotaFallback?.resetAt ?? account.resetAtSecondary ?? null;
  const primaryWindowMinutes =
    deferredPrimaryQuotaFallback?.windowMinutes ??
    account.windowMinutesPrimary ??
    null;
  const primaryTelemetryFresh = isFreshQuotaTelemetryTimestamp(
    primaryLastRecordedAt,
  );
  const secondaryTelemetryFresh = isFreshQuotaTelemetryTimestamp(
    secondaryLastRecordedAt,
  );
  const hasTelemetrySignal =
    freshDebugRawSampleCount > 0 ||
    primaryLastRecordedAt !== null ||
    secondaryLastRecordedAt !== null;
  const primaryTelemetryPending =
    hasLiveSession &&
    hasTelemetrySignal &&
    !primaryTelemetryFresh &&
    primaryRemainingRaw == null;
  const secondaryTelemetryPending =
    hasLiveSession &&
    hasTelemetrySignal &&
    !secondaryTelemetryFresh &&
    secondaryRemainingRaw == null;
  const primaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: account.accountId,
    windowKey: "primary",
    remainingPercent: primaryRemainingRaw,
    resetAt: primaryResetAt,
    hasLiveSession,
    lastRecordedAt: primaryLastRecordedAt,
    applyCycleFloor: mergedPrimaryRemainingPercent == null,
  });
  const secondaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: account.accountId,
    windowKey: "secondary",
    remainingPercent: secondaryRemainingRaw,
    resetAt: secondaryResetAt,
    hasLiveSession,
    lastRecordedAt: secondaryLastRecordedAt,
    applyCycleFloor: mergedSecondaryRemainingPercent == null,
  });
  const weeklyOnly =
    account.windowMinutesPrimary == null &&
    account.windowMinutesSecondary != null;
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
    codexSessionCount: account.codexSessionCount,
  });
  const useLocalDisabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemainingRaw,
    isActiveSnapshot,
    hasLiveSession,
    codexSessionCount: account.codexSessionCount,
  });

  const primaryReset = formatQuotaResetLabel(primaryResetAt);
  const secondaryReset = formatQuotaResetLabel(secondaryResetAt);
  const primaryWindowLabel = formatWindowLabel("primary", primaryWindowMinutes);
  const isDeactivated = status === "deactivated";
  const primaryLastSeen = formatLastUsageLabel(primaryLastRecordedAt);
  const secondaryLastSeen = formatLastUsageLabel(secondaryLastRecordedAt);
  const primaryLastSeenDisplay = resolveLastSeenDisplay(primaryLastSeen);
  const secondaryLastSeenDisplay = resolveLastSeenDisplay(secondaryLastSeen);
  const stalePrimaryLastSeen = !hasLiveSession
    ? primaryLastSeenDisplay
    : { label: null, upToDate: false };
  const staleSecondaryLastSeen = !hasLiveSession
    ? secondaryLastSeenDisplay
    : { label: null, upToDate: false };
  const deactivatedLastSeenDisplay =
    isDeactivated &&
    (primaryLastSeenDisplay.label || secondaryLastSeenDisplay.label)
      ? primaryLastSeenDisplay.label
        ? primaryLastSeenDisplay
        : secondaryLastSeenDisplay
      : null;

  const title = account.displayName || account.email;
  const compactId = formatCompactAccountId(account.accountId);
  const planWithSnapshot = formatPlanWithSnapshot(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const snapshotName = account.codexAuth?.snapshotName?.trim() ?? null;
  const expectedSnapshotName =
    account.codexAuth?.expectedSnapshotName?.trim() ?? null;
  const hasSnapshotMismatch = Boolean(
    snapshotName &&
    expectedSnapshotName &&
    snapshotName !== expectedSnapshotName,
  );
  const totalTokensUsed = tokensUsed ?? account.requestUsage?.totalTokens ?? 0;
  const tokenUsageLabel = isWorkingNow
    ? formatTokenUsagePrecise(totalTokensUsed)
    : formatTokenUsageCompact(totalTokensUsed);
  const codexLiveSessionCount = hasLiveSession
    ? Math.max(account.codexLiveSessionCount ?? 0, 1)
    : Math.max(account.codexLiveSessionCount ?? 0, 0);
  const codexTrackedSessionCount = Math.max(
    account.codexTrackedSessionCount ?? 0,
    0,
  );
  const hasSessionInventory =
    codexLiveSessionCount > 0 || codexTrackedSessionCount > 0;
  const codexCurrentTaskPreview =
    account.codexCurrentTaskPreview?.trim() || null;
  const quotaDebugLogText = useMemo(
    () =>
      liveQuotaDebug ? buildQuotaDebugLogLines(liveQuotaDebug).join("\n") : "",
    [liveQuotaDebug],
  );
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
          {deactivatedLastSeenDisplay ? (
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                deactivatedLastSeenDisplay.upToDate
                  ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "border-zinc-500/25 bg-zinc-500/10 text-zinc-600 dark:text-zinc-300",
              )}
              title={deactivatedLastSeenDisplay.label ?? undefined}
            >
              <Clock className="h-3 w-3" />
              {deactivatedLastSeenDisplay.label}
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

      <div className="mt-3 grid grid-cols-2 gap-2.5 rounded-lg border border-border/60 bg-background/35 px-2.5 py-2.5">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Tokens used
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold tabular-nums">
            <span>{tokenUsageLabel}</span>
            {isWorkingNow ? (
              <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                live
              </span>
            ) : null}
          </p>
        </div>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Codex CLI sessions
          </p>
          <p className="mt-0.5 text-xs font-semibold tabular-nums">
            {codexLiveSessionCount}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Tracked: {codexTrackedSessionCount}
          </p>
        </div>
      </div>

      {isWorkingNow && codexCurrentTaskPreview ? (
        <div className="mt-2.5 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.08] px-2.5 py-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
            Current task
          </p>
          <p
            className="mt-1 truncate text-xs text-cyan-800 dark:text-cyan-200"
            title={codexCurrentTaskPreview}
          >
            {codexCurrentTaskPreview}
          </p>
        </div>
      ) : null}

      {/* Quota bars */}
      <div
        className={cn(
          "mt-3.5 grid gap-2.5",
          weeklyOnly ? "grid-cols-1" : "grid-cols-2",
        )}
      >
        {!weeklyOnly && (
          <QuotaBar
            label={primaryWindowLabel}
            percent={primaryRemaining}
            resetLabel={primaryReset}
            lastSeenLabel={stalePrimaryLastSeen.label}
            lastSeenUpToDate={stalePrimaryLastSeen.upToDate}
            deactivated={isDeactivated}
            isLive={hasLiveSession}
            telemetryPending={primaryTelemetryPending}
          />
        )}
        <QuotaBar
          label="Weekly"
          percent={secondaryRemaining}
          resetLabel={secondaryReset}
          lastSeenLabel={staleSecondaryLastSeen.label}
          lastSeenUpToDate={staleSecondaryLastSeen.upToDate}
          isLive={hasLiveSession}
          telemetryPending={secondaryTelemetryPending}
        />
      </div>
      {liveQuotaDebug ? (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/25 bg-cyan-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-700/90 transition-colors hover:bg-cyan-500/15 hover:text-cyan-800 dark:text-cyan-200/90 dark:hover:text-cyan-100"
            aria-expanded={showQuotaDebug}
            aria-label="Debug"
            onClick={() => setShowQuotaDebug((current) => !current)}
          >
            Debug
            <ChevronDown
              className={cn(
                "h-3 w-3 transition-transform duration-200",
                showQuotaDebug && "rotate-180",
              )}
            />
          </button>

          {showQuotaDebug ? (
            <div className="mt-2 space-y-2 rounded-lg border border-cyan-500/25 bg-[#061325] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-300">
                  Quota logs
                </p>
                <div className="origin-right scale-90">
                  <CopyButton value={quotaDebugLogText} label="Copy logs" />
                </div>
              </div>
              <pre className="max-h-56 overflow-y-auto rounded-md border border-cyan-500/20 bg-[#020812] p-2.5 font-mono text-[11px] leading-5 text-cyan-100">
                <code>{quotaDebugLogText}</code>
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Actions */}
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t pt-3">
        <Button
          type="button"
          size="sm"
          variant="default"
          className={cn(
            "h-8 gap-1.5 rounded-lg border border-emerald-500/25 bg-emerald-500/15 px-3 text-xs font-semibold shadow-none hover:bg-emerald-500/25",
            canUseLocally
              ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200"
              : "text-muted-foreground",
          )}
          disabled={!canUseLocally || useLocalBusy}
          title={useLocalDisabledReason ?? undefined}
          onClick={() => onAction?.(account, "useLocal")}
        >
          Use this account
        </Button>
        {hasSnapshotMismatch ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onAction?.(account, "repairSnapshotReadd")}
            >
              Re-add snapshot
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
              onClick={() => onAction?.(account, "repairSnapshotRename")}
            >
              Rename snapshot
            </Button>
          </>
        ) : null}
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
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 rounded-lg text-xs text-cyan-700 hover:bg-cyan-500/10 hover:text-cyan-800 disabled:pointer-events-none disabled:text-muted-foreground dark:text-cyan-300 dark:hover:text-cyan-200"
          disabled={!hasSessionInventory}
          title={!hasSessionInventory ? "No tracked sessions" : undefined}
          onClick={() => onAction?.(account, "sessions")}
        >
          <ExternalLink className="h-3 w-3" />
          Sessions
        </Button>
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
