import {
  Activity,
  ChevronDown,
  Clock,
  Download,
  ExternalLink,
  Lock,
  Play,
  RotateCcw,
  SquareTerminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isEmailLabel, isLikelyEmailValue } from "@/components/blur-email";
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
  hasActiveCliSessionSignal,
  hasRecentUsageSignal,
  hasFreshLiveTelemetry,
  getWorkingNowUsageLimitHitCountdownMs,
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
  | "terminateCliSessions"
  | "repairSnapshotReadd"
  | "repairSnapshotRename";

export type AccountCardProps = {
  account: AccountSummary;
  tokensUsed?: number | null;
  tokensRemaining?: number | null;
  showTokensRemaining?: boolean;
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

function getPlanSnapshotDetails(
  planType: string,
  snapshotName?: string | null,
): {
  planLabel: string;
  snapshotLabel: string;
  snapshotIsEmail: boolean;
} {
  const planLabel = formatSlug(planType);
  const normalizedSnapshotName = snapshotName?.trim();
  if (!normalizedSnapshotName) {
    return {
      planLabel,
      snapshotLabel: "No snapshot",
      snapshotIsEmail: false,
    };
  }
  return {
    planLabel,
    snapshotLabel: normalizedSnapshotName,
    snapshotIsEmail: isLikelyEmailValue(normalizedSnapshotName),
  };
}

const NEAR_ZERO_QUOTA_PERCENT = 5;
const WAITING_FOR_NEW_TASK_LABEL = "Waiting for new task";
const SESSION_TASK_PREVIEW_MAX_ROWS = 4;
const NEXT_TASK_PREVIEW_PATTERN = /\bnext(?:\.?js)?\b|\bturbopack\b/i;

function hasNextTaskHint(taskPreview: string | null | undefined): boolean {
  const normalized = taskPreview?.trim();
  if (!normalized) {
    return false;
  }
  return NEXT_TASK_PREVIEW_PATTERN.test(normalized);
}

function NextTaskBadge() {
  return (
    <span
      className="inline-flex h-4 min-w-4 items-center justify-center rounded-full border border-cyan-500/35 bg-cyan-500/12 px-1 text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200"
      title="Next.js task"
      aria-label="Next.js task"
    >
      N
    </span>
  );
}

function formatSessionKeyLabel(sessionKey: string): string {
  const normalized = sessionKey.trim();
  if (normalized.length <= 18) {
    return normalized;
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

function resolveSessionTaskPreview(taskPreview: string | null | undefined): string {
  const normalized = taskPreview?.trim();
  return normalized && normalized.length > 0
    ? normalized
    : WAITING_FOR_NEW_TASK_LABEL;
}

function normalizeNearZeroQuotaPercent(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped > 0 && clamped < NEAR_ZERO_QUOTA_PERCENT) {
    return 0;
  }
  return clamped;
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
  usageLimitHit = false,
}: {
  label: string;
  percent: number | null;
  resetLabel: string;
  lastSeenLabel?: string | null;
  lastSeenUpToDate?: boolean;
  deactivated?: boolean;
  isLive?: boolean;
  telemetryPending?: boolean;
  usageLimitHit?: boolean;
}) {
  const clamped =
    percent === null ? 0 : normalizeNearZeroQuotaPercent(percent);
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
            {formatQuotaPercent(percent)}
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
              {usageLimitHit
                ? "Usage limit hit"
                : telemetryPending
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

function formatQuotaPercent(value: number | null): string {
  if (value == null || Number.isNaN(value)) {
    return "--";
  }

  const clamped = normalizeNearZeroQuotaPercent(value);
  const rounded = Math.round(clamped);
  if (Math.abs(clamped - rounded) < 0.05) {
    return `${rounded}%`;
  }
  return `${clamped.toFixed(1)}%`;
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

function hasExpiredRefreshTokenReason(reason: string | null | undefined): boolean {
  const normalized = reason?.trim().toLowerCase();
  if (!normalized || !normalized.includes("refresh token")) {
    return false;
  }
  return (
    normalized.includes("expired") ||
    normalized.includes("re-login required") ||
    normalized.includes("re-authentication") ||
    normalized.includes("reused") ||
    normalized.includes("revoked") ||
    normalized.includes("invalidated")
  );
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

function normalizeDebugSnapshotName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
}

function scopeQuotaDebugSamplesToAccount(
  liveQuotaDebug: NonNullable<AccountSummary["liveQuotaDebug"]>,
  accountSnapshotName: string | null | undefined,
) {
  const targetSnapshot = normalizeDebugSnapshotName(accountSnapshotName);
  const rawSamples = liveQuotaDebug.rawSamples;
  if (!targetSnapshot) {
    return rawSamples;
  }

  const exactSnapshotMatch = rawSamples.filter(
    (sample) => normalizeDebugSnapshotName(sample.snapshotName) === targetSnapshot,
  );
  if (exactSnapshotMatch.length > 0) {
    return exactSnapshotMatch;
  }

  const unnamedSamples = rawSamples.filter(
    (sample) => normalizeDebugSnapshotName(sample.snapshotName) == null,
  );
  if (unnamedSamples.length === 0) {
    return [];
  }

  const consideredSnapshots = (liveQuotaDebug.snapshotsConsidered ?? [])
    .map((value) => normalizeDebugSnapshotName(value))
    .filter((value): value is string => value != null);
  const consideredOnlyTarget =
    consideredSnapshots.length === 0 ||
    consideredSnapshots.every((snapshot) => snapshot === targetSnapshot);
  return consideredOnlyTarget ? unnamedSamples : [];
}

function buildQuotaDebugLogLines(
  liveQuotaDebug: NonNullable<AccountSummary["liveQuotaDebug"]>,
  accountSnapshotName: string | null | undefined,
  activeSnapshotName: string | null | undefined,
  accountId: string,
  mappedCliSessions: number,
  trackedCliSessions: number,
  displayedCliSessions: number,
  hasLiveSessionSignal: boolean,
  currentTaskPreview: string | null,
): string[] {
  const merged = liveQuotaDebug.merged;
  const scopedSamples = scopeQuotaDebugSamplesToAccount(
    liveQuotaDebug,
    accountSnapshotName,
  );
  const normalizedSnapshotName = accountSnapshotName?.trim() || "none";
  const normalizedActiveSnapshotName = activeSnapshotName?.trim() || "none";
  const normalizedCurrentTaskPreview = currentTaskPreview?.trim() || null;
  const selectedMatchesActive =
    normalizeDebugSnapshotName(normalizedSnapshotName) != null &&
    normalizeDebugSnapshotName(normalizedSnapshotName) ===
      normalizeDebugSnapshotName(normalizedActiveSnapshotName);
  const diagnosticOnly = liveQuotaDebug.overrideApplied !== true;
  const quotaSampledRows = scopedSamples.length;
  const liveSessionsWithoutQuotaRows = Math.max(
    mappedCliSessions - quotaSampledRows,
    0,
  );
  const lines: string[] = [
    `$ account=${accountId} snapshot=${normalizedSnapshotName}`,
    `$ cli_mapping selected_snapshot=${normalizedSnapshotName} active_snapshot=${normalizedActiveSnapshotName} match=${selectedMatchesActive ? "yes" : "no"}`,
    `$ cli_session_counts mapped=${mappedCliSessions} tracked=${trackedCliSessions} displayed=${displayedCliSessions} live_signal=${hasLiveSessionSignal ? "yes" : "no"}`,
    `$ merged 5h=${formatDebugPercent(merged?.primary?.remainingPercent)} weekly=${formatDebugPercent(merged?.secondary?.remainingPercent)}`,
    `$ override=${liveQuotaDebug.overrideReason ?? (liveQuotaDebug.overrideApplied ? "applied" : "none")}`,
    `$ attribution=${diagnosticOnly ? "diagnostic sample only (not attributed)" : "account-attributed override applied"}`,
    `$ flow=collect_cli_samples -> merge -> ${liveQuotaDebug.overrideApplied ? "apply_override" : "no_override"}`,
    `$ mapped_cli_sessions=${mappedCliSessions} quota_sampled_rows=${quotaSampledRows}`,
  ];

  if (liveSessionsWithoutQuotaRows > 0) {
    lines.push(
      `$ live_sessions_without_quota_rows=${liveSessionsWithoutQuotaRows}`,
    );
    if (
      hasLiveSessionSignal &&
      (normalizedCurrentTaskPreview == null ||
        normalizedCurrentTaskPreview === WAITING_FOR_NEW_TASK_LABEL)
    ) {
      lines.push("$ task_preview_state=waiting_for_new_task");
    }
  }

  if (liveQuotaDebug.snapshotsConsidered.length > 0) {
    lines.push(`$ snapshots=${liveQuotaDebug.snapshotsConsidered.join(", ")}`);
  }

  if (quotaSampledRows === 0) {
    lines.push(
      mappedCliSessions > 0
        ? "$ no quota-bearing cli samples"
        : "$ no cli sessions sampled",
    );
    return lines;
  }

  scopedSamples.slice(0, 24).forEach((sample, index) => {
    const staleSuffix = sample.stale ? " stale=true" : "";
    const snapshotSuffix = sample.snapshotName
      ? ` snapshot=${sample.snapshotName}`
      : "";
    const mappingSuffix = diagnosticOnly
      ? " mapping=diagnostic-only"
      : " mapping=snapshot-scoped-sample";
    lines.push(
      `$ cli-sample#${index + 1} src=${formatDebugSource(sample.source)} 5h=${formatDebugPercent(sample.primary?.remainingPercent)} weekly=${formatDebugPercent(sample.secondary?.remainingPercent)}${snapshotSuffix}${mappingSuffix}${staleSuffix}`,
    );
  });
  return lines;
}

function buildDebugLogFileName(accountId: string): string {
  const safeAccountId = accountId.replace(/[^a-zA-Z0-9._-]/g, "_");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cli-session-mapping-${safeAccountId}-${timestamp}.log`;
}

function saveQuotaDebugLogToFile(accountId: string, logs: string): void {
  if (!logs.trim()) {
    return;
  }
  const blob = new Blob([logs], { type: "text/plain;charset=utf-8" });
  const objectUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = buildDebugLogFileName(accountId);
  anchor.click();
  window.setTimeout(() => {
    window.URL.revokeObjectURL(objectUrl);
  }, 0);
}

function isLiveUsageLimitHit(input: {
  status: string;
  hasLiveSession: boolean;
  primaryRemainingPercent: number | null;
}): boolean {
  if (input.status === "rate_limited" || input.status === "quota_exceeded") {
    return true;
  }
  if (!input.hasLiveSession || input.primaryRemainingPercent == null) {
    return false;
  }
  return (
    normalizeNearZeroQuotaPercent(input.primaryRemainingPercent) <= 0
  );
}

function formatLimitHitCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function AccountCard(props: AccountCardProps) {
  const {
    account,
    tokensUsed = null,
    showTokensRemaining = false,
    showAccountId = false,
    useLocalBusy = false,
    onAction,
  } = props;
  const tokensRemaining = props.tokensRemaining ?? null;
  const hasExplicitUnknownTokensRemaining =
    showTokensRemaining &&
    Object.prototype.hasOwnProperty.call(props, "tokensRemaining") &&
    props.tokensRemaining == null;
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

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
  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account, nowMs);
  const blurred = usePrivacyStore((s) => s.blurred);
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = hasFreshLiveTelemetry(account, nowMs);
  const hasActiveCliSession = hasActiveCliSessionSignal(account, nowMs);
  const recentUsageSignal =
    (account.codexAuth?.hasSnapshot ?? false) && hasRecentUsageSignal(account, nowMs);
  const isWorkingNow = isAccountWorkingNow(account, nowMs);
  const usageLimitHitCountdownMs = getWorkingNowUsageLimitHitCountdownMs(account, nowMs);
  const usageLimitHitCountdownLabel =
    usageLimitHitCountdownMs != null && usageLimitHitCountdownMs > 0
      ? formatLimitHitCountdown(usageLimitHitCountdownMs)
      : null;
  const effectiveStatus = resolveEffectiveAccountStatus({
    status: account.status,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    allowDeactivatedOverride: false,
  });
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
  const usageLimitHit = isLiveUsageLimitHit({
    status: account.status,
    hasLiveSession,
    primaryRemainingPercent: primaryRemaining,
  });
  const remainingTokensValue = tokensRemaining ?? 0;
  const hasRemainingTokensExhausted =
    showTokensRemaining &&
    !hasExplicitUnknownTokensRemaining &&
    remainingTokensValue <= 0;
  const useLocalBlockedByWeeklyQuota =
    typeof secondaryRemaining === "number" &&
    normalizeNearZeroQuotaPercent(secondaryRemaining) < 1;
  const useLocalBlockedByPrimaryQuota =
    !weeklyOnly &&
    typeof primaryRemaining === "number" &&
    normalizeNearZeroQuotaPercent(primaryRemaining) < 1;
  const showUsageLimitHitBadge =
    usageLimitHit || hasRemainingTokensExhausted || useLocalBlockedByPrimaryQuota;
  const showWeeklyUsageLimitDetailBadge = useLocalBlockedByWeeklyQuota;
  const showLimitTint =
    showUsageLimitHitBadge || showWeeklyUsageLimitDetailBadge;
  const showUsageLimitGraceOverlay = Boolean(
    usageLimitHit && usageLimitHitCountdownMs != null && usageLimitHitCountdownMs > 0,
  );
  const hasExpiredRefreshToken =
    account.auth?.refresh?.state === "expired" ||
    hasExpiredRefreshTokenReason(account.deactivationReason);
  const status = usageLimitHit && effectiveStatus === "active" ? "limited" : effectiveStatus;
  const canUseLocally = canUseLocalAccount({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    secondaryRemainingPercent: secondaryRemaining,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const useLocalDisabledReason = getUseLocalAccountDisabledReason({
    status: account.status,
    primaryRemainingPercent: primaryRemaining,
    secondaryRemainingPercent: secondaryRemaining,
    hasSnapshot: account.codexAuth?.hasSnapshot,
    isActiveSnapshot,
    hasLiveSession: hasActiveCliSession,
    hasRecentUsageSignal: recentUsageSignal,
    codexSessionCount: account.codexSessionCount,
  });
  const useLocalButtonDisabled =
    !canUseLocally || useLocalBusy || useLocalBlockedByWeeklyQuota;
  const useLocalButtonDisabledReason = useLocalBlockedByWeeklyQuota
    ? "Weekly quota shown as 0%."
    : useLocalDisabledReason;
  const autoTerminateSignature = [
    account.accountId,
    account.codexAuth?.snapshotName ?? "",
    account.status,
    String(primaryRemaining ?? ""),
  ].join("|");
  const lastAutoTerminateSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const shouldAutoTerminateLiveSessions =
      usageLimitHit &&
      usageLimitHitCountdownMs != null &&
      usageLimitHitCountdownMs <= 0;

    if (!shouldAutoTerminateLiveSessions) {
      if (!usageLimitHit) {
        lastAutoTerminateSignatureRef.current = null;
      }
      return;
    }

    if (lastAutoTerminateSignatureRef.current === autoTerminateSignature) {
      return;
    }
    lastAutoTerminateSignatureRef.current = autoTerminateSignature;
    onAction?.(account, "terminateCliSessions");
  }, [
    account,
    autoTerminateSignature,
    onAction,
    usageLimitHit,
    usageLimitHitCountdownMs,
  ]);

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
  const titleIsEmail = isEmailLabel(title, account.email);
  const compactId = formatCompactAccountId(account.accountId);
  const planWithSnapshot = formatPlanWithSnapshot(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const { planLabel, snapshotLabel, snapshotIsEmail } = getPlanSnapshotDetails(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const snapshotName = account.codexAuth?.snapshotName?.trim() ?? null;
  const hasResolvedSnapshot = Boolean(snapshotName);
  const showMissingSnapshotLockOverlay = !hasResolvedSnapshot;
  const expectedSnapshotName =
    account.codexAuth?.expectedSnapshotName?.trim() ?? null;
  const hasSnapshotMismatch = Boolean(
    snapshotName &&
    expectedSnapshotName &&
    snapshotName !== expectedSnapshotName,
  );
  const tokenMetricLabel = showTokensRemaining ? "Tokens remaining" : "Tokens used";
  const tokenMetricValueRaw = showTokensRemaining
    ? remainingTokensValue
    : (tokensUsed ?? account.requestUsage?.totalTokens ?? 0);
  const tokenMetricValue = hasExplicitUnknownTokensRemaining
    ? "--"
    : isWorkingNow
      ? formatTokenUsagePrecise(tokenMetricValueRaw)
      : formatTokenUsageCompact(tokenMetricValueRaw);
  const hasRuntimeLiveSessionSignal =
    hasLiveSession ||
    (account.codexAuth?.hasLiveSession ?? false) ||
    Math.max(account.codexLiveSessionCount ?? 0, 0) > 0;
  const codexLiveSessionCountRaw = Math.max(account.codexLiveSessionCount ?? 0, 0);
  const codexLiveSessionCount = hasActiveCliSession
    ? hasRuntimeLiveSessionSignal
      ? Math.max(codexLiveSessionCountRaw, 1)
      : codexLiveSessionCountRaw
    : 0;
  const codexTrackedSessionCount = Math.max(
    account.codexTrackedSessionCount ?? 0,
    0,
  );
  const hasSessionInventory =
    codexLiveSessionCount > 0 || codexTrackedSessionCount > 0;
  const usageLimitHitGraceExpired = Boolean(
    usageLimitHit && usageLimitHitCountdownMs != null && usageLimitHitCountdownMs <= 0,
  );
  const codexCurrentTaskPreview = usageLimitHitGraceExpired
    ? null
    : account.codexCurrentTaskPreview?.trim() || null;
  const codexLastTaskPreview = account.codexLastTaskPreview?.trim() || null;
  const effectiveCurrentTaskPreview =
    codexCurrentTaskPreview ??
    (hasActiveCliSession && codexLiveSessionCount > 0
      ? WAITING_FOR_NEW_TASK_LABEL
      : null);
  const showLastTaskPreview =
    effectiveCurrentTaskPreview === WAITING_FOR_NEW_TASK_LABEL &&
    codexLastTaskPreview != null &&
    codexLastTaskPreview !== WAITING_FOR_NEW_TASK_LABEL;
  const sessionTaskPreviews = useMemo(() => {
    const seenSessionKeys = new Set<string>();
    const normalized = (account.codexSessionTaskPreviews ?? [])
      .filter((preview) => {
        const sessionKey = preview.sessionKey?.trim();
        if (!sessionKey || seenSessionKeys.has(sessionKey)) {
          return false;
        }
        seenSessionKeys.add(sessionKey);
        return true;
      })
      .slice(0, SESSION_TASK_PREVIEW_MAX_ROWS)
      .map((preview) => ({
        sessionKey: preview.sessionKey.trim(),
        taskPreview: resolveSessionTaskPreview(preview.taskPreview),
      }));
    return normalized;
  }, [account.codexSessionTaskPreviews]);
  const hasSessionTaskPreviews = sessionTaskPreviews.length > 0;
  const quotaDebugLogText = useMemo(
    () =>
      liveQuotaDebug
        ? buildQuotaDebugLogLines(
            liveQuotaDebug,
            account.codexAuth?.snapshotName ?? null,
            account.codexAuth?.activeSnapshotName ?? null,
            account.accountId,
            codexLiveSessionCountRaw,
            codexTrackedSessionCount,
            codexLiveSessionCount,
            Boolean(account.codexAuth?.hasLiveSession),
            effectiveCurrentTaskPreview,
          ).join("\n")
        : "",
    [
      account.accountId,
      account.codexAuth?.activeSnapshotName,
      account.codexAuth?.hasLiveSession,
      account.codexAuth?.snapshotName,
      codexLiveSessionCount,
      codexLiveSessionCountRaw,
      codexTrackedSessionCount,
      effectiveCurrentTaskPreview,
      liveQuotaDebug,
    ],
  );
  const emailSubtitle =
    account.displayName && account.displayName !== account.email
      ? account.email
      : null;
  const cardholderName = account.email?.trim() || title;
  const cardholderLine = `Gmail · ${cardholderName}`;
  const cardholderBlurred = blurred && isLikelyEmailValue(cardholderName);
  const tokenCardPrimaryLine = tokenMetricValue;
  const tokenCardSecondaryLine = String(codexLiveSessionCount);
  const accessibleTokenMetricValue =
    tokenMetricValue === "0"
      ? tokenMetricValue
      : `${tokenMetricValue} tokens`;
  const accessibleCodexSessionValue =
    codexLiveSessionCount <= 1
      ? String(codexLiveSessionCount)
      : `${codexLiveSessionCount} sessions`;
  const idSuffix = showAccountId ? ` | ID ${compactId}` : "";

  return (
    <div
      className={cn(
        "card-hover relative overflow-hidden rounded-xl border border-border/70 bg-gradient-to-b from-card to-card/80 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        showLimitTint &&
          "border-red-500/40 bg-gradient-to-b from-red-500/12 via-card to-card/85",
      )}
    >
      <div
        className={cn(
          (showUsageLimitGraceOverlay || showMissingSnapshotLockOverlay) &&
            "blur-[1.5px] saturate-[0.82]",
        )}
      >
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold leading-tight">
            {titleIsEmail && blurred ? (
              <span className="privacy-blur">{title}</span>
            ) : (
              title
            )}
          </p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {snapshotIsEmail && blurred ? (
              <>
                {planLabel} · <span className="privacy-blur">{snapshotLabel}</span>
              </>
            ) : (
              planWithSnapshot
            )}
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
          {showUsageLimitHitBadge ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              Usage limit hit
              {usageLimitHit && usageLimitHitCountdownLabel ? (
                <span className="font-medium text-red-700 dark:text-red-300">
                  · leaves in {usageLimitHitCountdownLabel}
                </span>
              ) : null}
            </Badge>
          ) : isWorkingNow ? (
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
          {showWeeklyUsageLimitDetailBadge ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300"
            >
              <span
                className="h-1.5 w-1.5 rounded-full bg-current"
                aria-hidden
              />
              Weekly usage limit hit
            </Badge>
          ) : null}
          {hasExpiredRefreshToken ? (
            <Badge
              variant="outline"
              className="gap-1.5 border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300"
              title={
                account.deactivationReason ??
                "Re-login is required to refresh the account token."
              }
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
              Expired refresh token
            </Badge>
          ) : null}
        </div>
      </div>

      <div className="relative mt-3 overflow-hidden rounded-[18px] border border-white/10 bg-[radial-gradient(120%_180%_at_0%_0%,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_42%),linear-gradient(118deg,#17191f_0%,#101217_52%,#07080b_100%)] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_16px_34px_rgba(0,0,0,0.55)]">
        <div
          className="pointer-events-none absolute -left-6 top-0 h-full w-28 rotate-[18deg] bg-white/[0.04]"
          aria-hidden
        />
        <div className="relative">
          <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-200/90">
            <span>OpenAI</span>
            <span>{hasLiveSession ? "Live token card" : "Token card"}</span>
          </div>
          <div className="mt-3 flex items-center gap-2 text-zinc-200/85">
            <div className="h-5 w-7 rounded-[4px] border border-amber-200/35 bg-[linear-gradient(145deg,#f2ca7d_0%,#d79a24_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
            <span className="text-xs tracking-[0.18em]">)))</span>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2.5 font-mono text-sm font-medium tracking-[0.22em] text-zinc-100 sm:text-base">
            <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5">
              {tokenCardPrimaryLine}
            </p>
            <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5">
              {tokenCardSecondaryLine}
            </p>
          </div>
          <div className="mt-3 border-t border-white/10 pt-2">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">
              Cardholder name
            </p>
            <p
              className={cn(
                "mt-1 truncate font-mono text-sm uppercase tracking-[0.15em] text-zinc-100",
                cardholderBlurred && "privacy-blur",
              )}
            >
              {cardholderLine}
            </p>
          </div>
        </div>
      </div>

      <div className="sr-only">
        <div className="min-w-0 space-y-2">
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {tokenMetricLabel}
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs font-semibold tabular-nums">
              <span>{accessibleTokenMetricValue}</span>
              {isWorkingNow ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                  live
                </span>
              ) : null}
            </p>
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Codex CLI sessions
            </p>
            <p className="mt-0.5 text-xs font-semibold tabular-nums">
              {accessibleCodexSessionValue}
            </p>
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              Tracked: {codexTrackedSessionCount}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Current task
          </p>
          <div className="mt-0.5 space-y-1">
            <p
              className="break-words whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
              title={effectiveCurrentTaskPreview ?? undefined}
            >
              <span className="inline-flex items-center gap-1.5">
                {hasNextTaskHint(effectiveCurrentTaskPreview) ? <NextTaskBadge /> : null}
                <span>{effectiveCurrentTaskPreview ?? "No active task reported"}</span>
              </span>
            </p>
            {showLastTaskPreview ? (
              <p
                className="break-words whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground/80"
                title={codexLastTaskPreview ?? undefined}
              >
                <span className="font-medium text-muted-foreground">Last task:</span>
                <span className="ml-1 inline-flex items-center gap-1.5">
                  {hasNextTaskHint(codexLastTaskPreview) ? <NextTaskBadge /> : null}
                  <span>{codexLastTaskPreview}</span>
                </span>
              </p>
            ) : null}
            {hasSessionTaskPreviews ? (
              <div className="mt-1.5 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.06] px-2.5 py-2">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-700 dark:text-cyan-300">
                  CLI session tasks
                </p>
                <ul className="space-y-1.5">
                  {sessionTaskPreviews.map((preview) => (
                    <li
                      key={preview.sessionKey}
                      className="grid grid-cols-[auto,1fr] items-start gap-2 text-xs"
                    >
                      <span className="inline-flex items-center rounded border border-cyan-500/25 bg-cyan-500/10 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-cyan-700 dark:text-cyan-300">
                        {formatSessionKeyLabel(preview.sessionKey)}
                      </span>
                      <span
                        className="break-words whitespace-pre-wrap leading-relaxed text-muted-foreground"
                        title={preview.taskPreview}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {hasNextTaskHint(preview.taskPreview) ? <NextTaskBadge /> : null}
                          <span>{preview.taskPreview}</span>
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
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
            label={primaryWindowLabel}
            percent={primaryRemaining}
            resetLabel={primaryReset}
            lastSeenLabel={stalePrimaryLastSeen.label}
            lastSeenUpToDate={stalePrimaryLastSeen.upToDate}
            deactivated={isDeactivated}
            isLive={hasLiveSession}
            telemetryPending={primaryTelemetryPending}
            usageLimitHit={usageLimitHit}
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
                  CLI session logs
                </p>
                <div className="flex items-center gap-1.5 origin-right scale-90">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-200 hover:bg-cyan-500/10 hover:text-cyan-100"
                    onClick={() =>
                      saveQuotaDebugLogToFile(account.accountId, quotaDebugLogText)
                    }
                  >
                    <Download className="h-3 w-3" />
                    Save log file
                  </Button>
                  <CopyButton value={quotaDebugLogText} label="Copy logs" />
                </div>
              </div>
              <div className="rounded-md border border-cyan-500/20 bg-[#020812] p-1.5">
                <ol className="max-h-56 overflow-y-auto font-mono text-[11px] leading-5 text-cyan-100">
                  {quotaDebugLogText.split("\n").map((line, index) => (
                    <li
                      key={`${account.accountId}-debug-line-${index}`}
                      className="grid grid-cols-[2.2rem_minmax(0,1fr)] gap-2 rounded-sm px-1.5 even:bg-cyan-500/[0.06]"
                    >
                      <span className="select-none text-right text-cyan-400/55">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="break-all">{line}</span>
                    </li>
                  ))}
                </ol>
              </div>
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
          disabled={useLocalButtonDisabled}
          title={useLocalButtonDisabledReason ?? undefined}
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
        {(status === "deactivated" || hasExpiredRefreshToken) && (
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
      {showUsageLimitGraceOverlay ? (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="rounded-xl border border-red-500/40 bg-red-500/14 px-4 py-2.5 text-center shadow-lg backdrop-blur-[2px]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-red-700 dark:text-red-300">
              Usage limit hit
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums text-red-800 dark:text-red-200">
              Leaving working now in {usageLimitHitCountdownLabel}
            </p>
          </div>
        </div>
      ) : null}
      {showMissingSnapshotLockOverlay ? (
        <div className="absolute inset-0 z-30 flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/45 backdrop-blur-[1.5px]" aria-hidden />
          <div className="relative flex w-full max-w-[13rem] flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/75 px-4 py-3.5 text-center shadow-[0_20px_55px_rgba(0,0,0,0.55)] backdrop-blur-md">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/10">
              <Lock className="h-4 w-4 text-cyan-200" aria-hidden />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
              Locked account
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-lg border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-100 hover:border-cyan-400/35 hover:bg-cyan-400/12 hover:text-cyan-100"
              onClick={() => onAction?.(account, "reauth")}
            >
              Unlock
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
