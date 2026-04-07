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
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { isLikelyEmailValue } from "@/components/blur-email";
import { CopyButton } from "@/components/copy-button";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useNavigate } from "@/lib/router-compat";
import { cn } from "@/lib/utils";
import type { AccountSummary } from "@/features/dashboard/schemas";
import {
  buildQuotaDisplayAccountKey,
  formatCompactAccountId,
} from "@/utils/account-identifiers";
import {
  quotaBarTrack,
  resolveEffectiveAccountStatus,
} from "@/utils/account-status";
import { STATUS_LABELS } from "@/utils/constants";
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
  | "delete"
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
  deleteBusy?: boolean;
  initialSessionTasksCollapsed?: boolean;
  disableSecondaryActions?: boolean;
  forceWorkingIndicator?: boolean;
  hideCurrentTaskPreview?: boolean;
  taskPanelAddon?: ReactNode;
  primaryActionLabel?: string;
  primaryActionAriaLabel?: string;
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

function isCodexOnlyPlanType(planType: string): boolean {
  const normalized = planType.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return normalized === "self_serve_business_usage_based";
}

const NEAR_ZERO_QUOTA_PERCENT = 5;
const WAITING_FOR_NEW_TASK_LABEL = "Waiting for new task";
const TASK_FINISHED_LABEL = "Task finished";
const TASK_PREVIEW_TRUNCATION_LENGTH = 100;
const TASK_FINISHED_PREVIEW_RE =
  /^(?:task\s+)?(?:is\s+)?(?:already\s+)?(?:done|complete(?:d)?|finished)(?:\s+already)?[.!]?$/i;
const UNKNOWN_TOKENS_SYNC_LABEL = "syncing…";
const NEXT_TASK_PREVIEW_PATTERN = /\bnext(?:\.?js)?\b|\bturbopack\b/i;
const CURRENT_TASK_PREVIEW_EXPANSION_KEY = "__current_task_preview__";
const LAST_TASK_PREVIEW_EXPANSION_KEY = "__last_task_preview__";

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

function TaskFinishedPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full bg-emerald-500/10 px-2.5 text-emerald-200",
        className,
      )}
    >
      <span className="sr-only">Task finished</span>
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        task finished
      </span>
    </div>
  );
}

function resolveWaitingTaskPillLabel(
  taskPreview: string | null | undefined,
): string {
  const normalized = taskPreview?.trim().toLowerCase() ?? "";
  if (!normalized) {
    return "waiting";
  }
  if (normalized.includes("email")) {
    return "waiting for email";
  }
  if (normalized.includes("submit")) {
    return "waiting for submit";
  }
  if (
    normalized.includes("input") ||
    normalized.includes("confirm") ||
    normalized.includes("interrupt")
  ) {
    return "waiting for input";
  }
  if (normalized.startsWith("waiting") || normalized.startsWith("awaiting")) {
    return normalized;
  }
  return "waiting";
}

function getTaskPreviewExcerpt(taskPreview: string): {
  text: string;
  truncated: boolean;
} {
  if (taskPreview.length <= TASK_PREVIEW_TRUNCATION_LENGTH) {
    return {
      text: taskPreview,
      truncated: false,
    };
  }

  return {
    text: `${taskPreview.slice(0, TASK_PREVIEW_TRUNCATION_LENGTH).trimEnd()}…`,
    truncated: true,
  };
}

function WaitingForTaskPill({
  className,
  label = "waiting",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full border border-cyan-400/35 bg-cyan-500/12 px-2.5 text-cyan-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
        className,
      )}
    >
      <span className="sr-only">Waiting for new task</span>
      <span className="relative inline-flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full rounded-full bg-cyan-300/55 animate-ping [animation-duration:1.4s]" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-200" />
      </span>
      <span className="max-w-[156px] truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        {label}
      </span>
    </div>
  );
}

function ThinkingTaskPill({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "inline-flex h-7 items-center gap-2 rounded-full bg-indigo-500/14 px-2.5 text-indigo-200",
        className,
      )}
    >
      <span className="sr-only">Thinking</span>
      <span className="flex items-end gap-0.5" aria-hidden>
        <span className="h-1.5 w-1 rounded-full bg-zinc-100/95 animate-pulse [animation-duration:900ms]" />
        <span className="h-2.5 w-1 rounded-full bg-indigo-100/95 animate-pulse [animation-delay:140ms] [animation-duration:900ms]" />
        <span className="h-3 w-1 rounded-full bg-cyan-200/95 animate-pulse [animation-delay:280ms] [animation-duration:900ms]" />
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
        thinking
      </span>
    </div>
  );
}

type SessionTaskState = "finished" | "waiting" | "thinking";
type SessionTaskRow = {
  sessionKey: string;
  taskPreview: string;
  taskUpdatedAt: string | null;
  ordinal: number;
  synthetic: boolean;
};

function isWaitingTaskPreview(taskPreview: string): boolean {
  const normalized = taskPreview.trim().toLowerCase();
  if (normalized === WAITING_FOR_NEW_TASK_LABEL.toLowerCase()) {
    return true;
  }
  return (
    normalized.startsWith("waiting") ||
    normalized.startsWith("awaiting") ||
    normalized.includes("waiting for") ||
    normalized.includes("wait for user") ||
    normalized.includes("waiting for user") ||
    normalized.includes("awaiting user")
  );
}

function resolveWaitingTaskHelperText(taskPreview: string): string {
  const normalized = taskPreview.trim().toLowerCase();
  if (normalized.includes("submit")) {
    return "Waiting for user to press submit.";
  }
  if (normalized.includes("email")) {
    return "Waiting for user email input.";
  }
  if (
    normalized.includes("input") ||
    normalized.includes("interrupt") ||
    normalized.includes("confirm")
  ) {
    return "Waiting for user input.";
  }
  return "No task assigned yet for this account.";
}

function resolveSessionTaskState(taskPreview: string): SessionTaskState {
  const normalized = taskPreview.trim().toLowerCase();
  if (
    normalized === TASK_FINISHED_LABEL.toLowerCase() ||
    TASK_FINISHED_PREVIEW_RE.test(taskPreview.trim())
  ) {
    return "finished";
  }
  if (isWaitingTaskPreview(taskPreview)) {
    return "waiting";
  }
  return "thinking";
}

function resolveSessionTaskStateForRow(
  row: SessionTaskRow,
  {
    hasLiveCliSessions,
  }: {
    hasLiveCliSessions: boolean;
  },
): SessionTaskState {
  const baseState = resolveSessionTaskState(row.taskPreview);
  if (baseState !== "thinking") {
    return baseState;
  }
  if (row.synthetic) {
    return "waiting";
  }
  if (hasLiveCliSessions) {
    return "thinking";
  }
  return "finished";
}

function SessionTaskStatePill({
  taskPreview,
  className,
  stateOverride,
}: {
  taskPreview: string;
  className?: string;
  stateOverride?: SessionTaskState;
}) {
  const state = stateOverride ?? resolveSessionTaskState(taskPreview);
  if (state === "finished") {
    return <TaskFinishedPill className={className} />;
  }
  if (state === "waiting") {
    return <WaitingForTaskPill className={className} />;
  }
  return <ThinkingTaskPill className={className} />;
}

function formatSessionKeyLabel(sessionKey: string): string {
  const normalized = sessionKey.trim();
  if (normalized.length <= 18) {
    return normalized;
  }
  return `${normalized.slice(0, 6)}…${normalized.slice(-4)}`;
}

function resolveSessionTaskPreview(
  taskPreview: string | null | undefined,
): string {
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
  inTokenCard = false,
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
  inTokenCard?: boolean;
}) {
  const clamped = percent === null ? 0 : normalizeNearZeroQuotaPercent(percent);
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
        inTokenCard && "border-white/10 bg-black/25",
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
          usageLimitHit || telemetryPending ? (
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-700 dark:text-cyan-300">
              <Activity className="h-3 w-3" />
              <span>
                {usageLimitHit
                  ? "Usage limit hit"
                  : "Telemetry pending"}
              </span>
            </div>
          ) : null
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

function hasExpiredRefreshTokenReason(
  reason: string | null | undefined,
): boolean {
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

function normalizeDebugSnapshotName(
  value: string | null | undefined,
): string | null {
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
    (sample) =>
      normalizeDebugSnapshotName(sample.snapshotName) === targetSnapshot,
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
  return normalizeNearZeroQuotaPercent(input.primaryRemainingPercent) <= 0;
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
    deleteBusy = false,
    initialSessionTasksCollapsed = false,
    disableSecondaryActions = false,
    forceWorkingIndicator = false,
    hideCurrentTaskPreview = false,
    taskPanelAddon,
    primaryActionLabel = "Use this account",
    primaryActionAriaLabel,
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
  const [sessionTasksCollapsed, setSessionTasksCollapsed] = useState(
    initialSessionTasksCollapsed,
  );
  const [expandedTaskPreviewKeys, setExpandedTaskPreviewKeys] = useState<
    string[]
  >([]);
  const isTaskPreviewExpanded = (key: string) =>
    expandedTaskPreviewKeys.includes(key);
  const toggleTaskPreviewExpanded = (key: string) => {
    setExpandedTaskPreviewKeys((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
  };
  const navigate = useNavigate();
  const liveQuotaDebug = account.liveQuotaDebug ?? null;
  const quotaDisplayAccountKey = buildQuotaDisplayAccountKey(account);
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
  const hasLivePrimaryQuotaTelemetrySource =
    mergedPrimaryRemainingPercent != null || deferredPrimaryQuotaFallback != null;
  const hasLiveSecondaryQuotaTelemetrySource =
    mergedSecondaryRemainingPercent != null || deferredSecondaryQuotaFallback != null;
  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account, nowMs);
  const blurred = usePrivacyStore((s) => s.blurred);
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = hasFreshLiveTelemetry(account, nowMs);
  const hasActiveCliSession = hasActiveCliSessionSignal(account, nowMs);
  const recentUsageSignal =
    (account.codexAuth?.hasSnapshot ?? false) &&
    hasRecentUsageSignal(account, nowMs);
  const isWorkingNow = isAccountWorkingNow(account, nowMs);
  const usageLimitHitCountdownMs = getWorkingNowUsageLimitHitCountdownMs(
    account,
    nowMs,
  );
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
    allowDeactivatedOverride: isWorkingNow,
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
      fallbackRemainingPercent:
        deferredSecondaryQuotaFallback?.remainingPercent,
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
    accountKey: quotaDisplayAccountKey,
    windowKey: "primary",
    remainingPercent: primaryRemainingRaw,
    resetAt: primaryResetAt,
    hasLiveSession: hasLiveSession && hasLivePrimaryQuotaTelemetrySource,
    lastRecordedAt: primaryLastRecordedAt,
    applyCycleFloor: mergedPrimaryRemainingPercent == null,
  });
  const secondaryRemaining = normalizeRemainingPercentForDisplay({
    accountKey: quotaDisplayAccountKey,
    windowKey: "secondary",
    remainingPercent: secondaryRemainingRaw,
    resetAt: secondaryResetAt,
    hasLiveSession: hasLiveSession && hasLiveSecondaryQuotaTelemetrySource,
    lastRecordedAt: secondaryLastRecordedAt,
    applyCycleFloor: mergedSecondaryRemainingPercent == null,
  });
  const weeklyOnly =
    account.windowMinutesPrimary == null &&
    account.windowMinutesSecondary != null;
  const codexOnlyQuotaStatusUnknown =
    isCodexOnlyPlanType(account.planType) &&
    !hasLiveSession &&
    primaryRemainingRaw == null &&
    secondaryRemainingRaw == null;
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
    usageLimitHit ||
    hasRemainingTokensExhausted ||
    useLocalBlockedByPrimaryQuota;
  const showWeeklyUsageLimitDetailBadge = useLocalBlockedByWeeklyQuota;
  const showLimitTint =
    showUsageLimitHitBadge || showWeeklyUsageLimitDetailBadge;
  const showUsageLimitGraceOverlay = Boolean(
    usageLimitHit &&
    usageLimitHitCountdownMs != null &&
    usageLimitHitCountdownMs > 0,
  );
  const hasExpiredRefreshToken =
    account.auth?.refresh?.state === "expired" ||
    hasExpiredRefreshTokenReason(account.deactivationReason);
  const status =
    usageLimitHit && effectiveStatus === "active" ? "limited" : effectiveStatus;
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

  const handleUnlock = () => {
    if (onAction) {
      onAction(account, "reauth");
      return;
    }

    const selectedAccountId = encodeURIComponent(account.accountId);
    const unlockTarget = `/accounts?selected=${selectedAccountId}&oauth=prompt`;
    if (typeof window !== "undefined") {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      if (currentPath === unlockTarget) {
        return;
      }
    }
    navigate(unlockTarget);
  };

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
  const weeklyFallbackStateLabel =
    codexOnlyQuotaStatusUnknown && !staleSecondaryLastSeen.label
      ? `Last known: ${STATUS_LABELS[status] ?? status}`
      : null;
  const showPrimaryQuotaBar = !weeklyOnly && !codexOnlyQuotaStatusUnknown;
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
  const { planLabel, snapshotLabel, snapshotIsEmail } = getPlanSnapshotDetails(
    account.planType,
    account.codexAuth?.snapshotName,
  );
  const showCodexOnlyAccountSubtitle = isCodexOnlyPlanType(account.planType);
  const codexOnlyEmailLabel = snapshotIsEmail
    ? snapshotLabel
    : (account.email?.trim() ?? null);
  const codexOnlyEmailIsSensitive = isLikelyEmailValue(codexOnlyEmailLabel);
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
  const tokenMetricLabel = showTokensRemaining
    ? "Tokens remaining"
    : "Tokens used";
  const tokenMetricValueRaw = showTokensRemaining
    ? remainingTokensValue
    : (tokensUsed ?? account.requestUsage?.totalTokens ?? 0);
  const hasFreshQuotaTelemetryHint =
    freshDebugRawSampleCount > 0 || primaryTelemetryFresh || secondaryTelemetryFresh;
  const tokenMetricValue = hasExplicitUnknownTokensRemaining
    ? hasLiveSession && hasFreshQuotaTelemetryHint
      ? UNKNOWN_TOKENS_SYNC_LABEL
      : "--"
    : isWorkingNow
      ? formatTokenUsagePrecise(tokenMetricValueRaw)
      : formatTokenUsageCompact(tokenMetricValueRaw);
  const hasRuntimeLiveSessionSignal =
    hasLiveSession ||
    (account.codexAuth?.hasLiveSession ?? false) ||
    Math.max(account.codexLiveSessionCount ?? 0, 0) > 0;
  const codexLiveSessionCountRaw = Math.max(
    account.codexLiveSessionCount ?? 0,
    0,
  );
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
    usageLimitHit &&
    usageLimitHitCountdownMs != null &&
    usageLimitHitCountdownMs <= 0,
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
  const displayCurrentTaskPreview = effectiveCurrentTaskPreview;
  const currentTaskPreviewExcerpt = displayCurrentTaskPreview
    ? getTaskPreviewExcerpt(displayCurrentTaskPreview)
    : null;
  const currentTaskPreviewExpanded = isTaskPreviewExpanded(
    CURRENT_TASK_PREVIEW_EXPANSION_KEY,
  );
  const displayCurrentTaskPreviewText =
    currentTaskPreviewExcerpt?.truncated && !currentTaskPreviewExpanded
      ? currentTaskPreviewExcerpt.text
      : displayCurrentTaskPreview;
  const lastTaskPreviewExcerpt = codexLastTaskPreview
    ? getTaskPreviewExcerpt(codexLastTaskPreview)
    : null;
  const lastTaskPreviewExpanded = isTaskPreviewExpanded(
    LAST_TASK_PREVIEW_EXPANSION_KEY,
  );
  const displayLastTaskPreviewText =
    lastTaskPreviewExcerpt?.truncated && !lastTaskPreviewExpanded
      ? lastTaskPreviewExcerpt.text
      : codexLastTaskPreview;
  const isCurrentTaskWaiting = displayCurrentTaskPreview
    ? isWaitingTaskPreview(displayCurrentTaskPreview)
    : false;
  const waitingTaskPillLabel = resolveWaitingTaskPillLabel(
    displayCurrentTaskPreview,
  );
  const hideTaskContainerChrome = hideCurrentTaskPreview && Boolean(taskPanelAddon);
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
      .map((preview) => ({
        sessionKey: preview.sessionKey.trim(),
        taskPreview: resolveSessionTaskPreview(preview.taskPreview),
        taskUpdatedAt: preview.taskUpdatedAt ?? null,
      }));
    return normalized;
  }, [account.codexSessionTaskPreviews]);
  const sessionTaskRows = useMemo(() => {
    const rows: SessionTaskRow[] = sessionTaskPreviews.map((preview, index) => ({
      ...preview,
      ordinal: index + 1,
      synthetic: false,
    }));
    const targetCount = Math.max(codexLiveSessionCount, rows.length);
    for (let index = rows.length; index < targetCount; index += 1) {
      rows.push({
        sessionKey: `live-session-${index + 1}`,
        taskPreview: WAITING_FOR_NEW_TASK_LABEL,
        taskUpdatedAt: null,
        ordinal: index + 1,
        synthetic: true,
      });
    }
    return rows;
  }, [codexLiveSessionCount, sessionTaskPreviews]);
  const hasSessionTaskRows = sessionTaskRows.length > 0;
  const hasLiveCliSessions = codexLiveSessionCount > 0;
  const sessionTaskStates = useMemo(
    () =>
      sessionTaskRows.map((row) =>
        resolveSessionTaskStateForRow(row, {
          hasLiveCliSessions,
        }),
      ),
    [hasLiveCliSessions, sessionTaskRows],
  );
  const hasThinkingSessionTaskPreview = sessionTaskStates.some(
    (state) => state === "thinking",
  );
  const showWorkingIndicator =
    forceWorkingIndicator ||
    hasThinkingSessionTaskPreview ||
    (isWorkingNow && !isCurrentTaskWaiting);
  const showWaitingForTaskIndicator =
    !showWorkingIndicator && isWorkingNow && isCurrentTaskWaiting;
  const sessionTaskSummary = useMemo(() => {
    const waitingCount = sessionTaskStates.filter(
      (state) => state === "waiting",
    ).length;
    const finishedCount = sessionTaskStates.filter(
      (state) => state === "finished",
    ).length;
    const thinkingCount = sessionTaskStates.filter(
      (state) => state === "thinking",
    ).length;
    const assignedCount = Math.max(sessionTaskStates.length - waitingCount, 0);
    return {
      waitingCount,
      finishedCount,
      thinkingCount,
      assignedCount,
    };
  }, [sessionTaskStates]);
  const quotaDebugLogText = liveQuotaDebug
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
    : "";
  const lockedAccountIdentity =
    account.email?.trim() || account.displayName?.trim() || title.trim();
  const lockedAccountIdentityBlurred =
    blurred && isLikelyEmailValue(lockedAccountIdentity);
  const tokenCardPrimaryLine = tokenMetricValue;
  const tokenCardSecondaryLine = String(codexLiveSessionCount);
  const tokenMetricLooksNumeric = /^[\d,.]+(?:[kmbt])?$/i.test(tokenMetricValue);
  const accessibleTokenMetricValue =
    tokenMetricLooksNumeric && tokenMetricValue !== "0"
      ? `${tokenMetricValue} tokens`
      : tokenMetricValue;
  const accessibleCodexSessionValue =
    codexLiveSessionCount <= 1
      ? String(codexLiveSessionCount)
      : `${codexLiveSessionCount} sessions`;
  const idSuffix = showAccountId ? ` | ID ${compactId}` : "";
  const tokenCardStatusClass = cn(
    "h-7 gap-1.5 rounded-full border px-3 text-[11px] font-semibold tracking-[0.02em] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]",
    status === "active" &&
      "border-emerald-500/35 bg-emerald-500/14 text-emerald-300",
    status === "paused" && "border-amber-500/35 bg-amber-500/14 text-amber-200",
    status === "limited" &&
      "border-orange-500/35 bg-orange-500/14 text-orange-200",
    status === "exceeded" && "border-red-500/35 bg-red-500/14 text-red-200",
    status === "deactivated" &&
      "border-zinc-500/35 bg-zinc-500/14 text-zinc-300",
  );
  return (
    <div className="relative">
      <div
        className={cn(
          (showUsageLimitGraceOverlay || showMissingSnapshotLockOverlay) &&
            "blur-[1.5px] saturate-[0.82]",
        )}
      >
        <div
          className={cn(
            "card-hover relative overflow-hidden rounded-[18px] border border-white/10 bg-[#101826] px-3.5 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_42px_rgba(0,0,0,0.58)]",
            showLimitTint && "border-red-500/40",
          )}
        >
          <div className="relative">
            <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5">
              <Badge variant="outline" className={tokenCardStatusClass}>
                <span
                  className="h-1.5 w-1.5 rounded-full bg-current"
                  aria-hidden
                />
                {STATUS_LABELS[status] ?? status}
              </Badge>
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
              ) : showWorkingIndicator ? (
                <div className="inline-flex h-7 items-center gap-2 rounded-full border border-cyan-500/35 px-2.5 text-cyan-200">
                  <span className="sr-only">Codex working</span>
                  <span className="flex items-end gap-1" aria-hidden>
                    <span className="h-2 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-duration:900ms]" />
                    <span className="h-3 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-delay:140ms] [animation-duration:900ms]" />
                    <span className="h-4 w-1 rounded-full bg-cyan-200/95 shadow-[0_0_10px_rgba(103,232,249,0.35)] animate-bounce [animation-delay:280ms] [animation-duration:900ms]" />
                    <span className="h-3 w-1 rounded-full bg-zinc-100/95 shadow-[0_0_8px_rgba(255,255,255,0.25)] animate-bounce [animation-delay:420ms] [animation-duration:900ms]" />
                  </span>
                  <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-100/95">
                    working...
                  </span>
                </div>
              ) : showWaitingForTaskIndicator ? (
                <WaitingForTaskPill label={waitingTaskPillLabel} />
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
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-current"
                    aria-hidden
                  />
                  Expired refresh token
                </Badge>
              ) : null}
            </div>
            <div className="flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-200/90">
              <span className="inline-flex items-center gap-1.5 text-zinc-100">
                <img
                  src="/openai.svg"
                  alt=""
                  className="h-3.5 w-3.5 opacity-80 brightness-0 invert"
                  aria-hidden
                />
                OpenAI
              </span>
              <span>{hasLiveSession ? "Live token card" : "Token card"}</span>
            </div>
            <p
              className="mt-1 truncate text-[11px] font-semibold uppercase tracking-[0.13em] text-zinc-300"
              title={
                showAccountId ? `Account ID ${account.accountId}` : undefined
              }
            >
              {showCodexOnlyAccountSubtitle ? (
                codexOnlyEmailLabel ? (
                  <>
                    CODEX ONLY ACCOUNT ·{" "}
                    {codexOnlyEmailIsSensitive && blurred ? (
                      <span className="privacy-blur">{codexOnlyEmailLabel}</span>
                    ) : (
                      codexOnlyEmailLabel
                    )}
                  </>
                ) : (
                  "CODEX ONLY ACCOUNT"
                )
              ) : snapshotIsEmail && blurred ? (
                <>
                  {planLabel} ·{" "}
                  <span className="privacy-blur">{snapshotLabel}</span>
                </>
              ) : (
                planWithSnapshot
              )}
              {idSuffix}
            </p>
            <div className="mt-3 flex items-center gap-2 text-zinc-200/85">
              <div className="h-5 w-7 rounded-[4px] border border-amber-200/35 bg-[linear-gradient(145deg,#f2ca7d_0%,#d79a24_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]" />
              <span className="text-xs tracking-[0.18em]">)))</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  Tokens:
                </p>
                <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.22em] text-zinc-100 sm:text-base">
                  {tokenCardPrimaryLine}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">
                  CLI sessions:
                </p>
                <p className="truncate rounded-md border border-white/10 bg-black/30 px-2.5 py-1.5 font-mono text-sm font-medium tracking-[0.22em] text-zinc-100 sm:text-base">
                  {tokenCardSecondaryLine}
                </p>
              </div>
            </div>
            <div className="mt-3 border-t border-white/10 pt-3">
              <div
                className={cn(
                  "grid gap-2.5",
                  showPrimaryQuotaBar ? "grid-cols-2" : "grid-cols-1",
                )}
              >
                {showPrimaryQuotaBar && (
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
                    inTokenCard
                  />
                )}
                <QuotaBar
                  label="Weekly"
                  percent={secondaryRemaining}
                  resetLabel={secondaryReset}
                  lastSeenLabel={
                    staleSecondaryLastSeen.label ?? weeklyFallbackStateLabel
                  }
                  lastSeenUpToDate={staleSecondaryLastSeen.upToDate}
                  isLive={hasLiveSession}
                  telemetryPending={secondaryTelemetryPending}
                  inTokenCard
                />
              </div>
            </div>

            <div className="relative mt-3.5 overflow-hidden">
              <div
                className="pointer-events-none absolute inset-0 -z-10"
                aria-hidden
              >
                <div className="absolute left-2 right-8 top-3 h-8 rounded-full bg-cyan-500/[0.09] blur-xl animate-pulse" />
                <div className="absolute left-10 right-2 top-8 h-7 rounded-full bg-indigo-500/[0.07] blur-2xl animate-pulse [animation-delay:350ms]" />
              </div>

              <div className="space-y-1.5">
                <div
                  className={cn(
                    "relative transition-all duration-200",
                    hideTaskContainerChrome
                      ? "px-0 py-0"
                      : cn(
                          "rounded-lg border px-2.5 py-2",
                          isCurrentTaskWaiting
                            ? "border-cyan-400/20 bg-black/55 hover:border-cyan-300/35 hover:bg-black/65 hover:shadow-[0_0_0_1px_rgba(34,211,238,0.14),0_8px_18px_rgba(0,0,0,0.35)]"
                            : "border-indigo-400/20 bg-[linear-gradient(145deg,rgba(56,189,248,0.08)_0%,rgba(79,70,229,0.2)_60%,rgba(15,23,42,0.75)_100%)] hover:border-cyan-300/35 hover:shadow-[0_0_0_1px_rgba(99,102,241,0.18),0_8px_18px_rgba(6,24,44,0.45)]",
                        ),
                  )}
                >
                  {!hideTaskContainerChrome ? (
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-0 -z-10 rounded-lg",
                        isCurrentTaskWaiting
                          ? "bg-[linear-gradient(90deg,rgba(15,23,42,0.72)_0%,rgba(2,8,23,0.4)_100%)]"
                          : "bg-[linear-gradient(90deg,rgba(34,211,238,0.08)_0%,rgba(34,211,238,0)_65%)] animate-pulse",
                      )}
                      aria-hidden
                    />
                  ) : null}
                  {!hideCurrentTaskPreview ? (
                    <div>
                      {!isCurrentTaskWaiting && displayCurrentTaskPreview ? (
                        <div className="mb-1 inline-flex h-5 items-center gap-1.5 rounded-full border border-indigo-300/30 bg-indigo-500/15 px-2 text-[9px] font-semibold uppercase tracking-[0.12em] text-indigo-100/95">
                          <span
                            className="h-1.5 w-1.5 rounded-full bg-cyan-200/95"
                            aria-hidden
                          />
                          Codex reply
                        </div>
                      ) : null}
                      <p
                        className="break-words whitespace-pre-wrap text-sm leading-relaxed text-zinc-100/95"
                        title={effectiveCurrentTaskPreview ?? undefined}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          {hasNextTaskHint(effectiveCurrentTaskPreview) ? (
                            <NextTaskBadge />
                          ) : null}
                          <span>
                            {displayCurrentTaskPreviewText ??
                              "No active task reported"}
                          </span>
                        </span>
                      </p>
                      {currentTaskPreviewExcerpt?.truncated ? (
                        <button
                          type="button"
                          className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-200 transition-colors hover:text-cyan-100"
                          aria-expanded={currentTaskPreviewExpanded}
                          onClick={() =>
                            toggleTaskPreviewExpanded(
                              CURRENT_TASK_PREVIEW_EXPANSION_KEY,
                            )
                          }
                        >
                          {currentTaskPreviewExpanded ? "Show Less" : "View Full"}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  {taskPanelAddon ? (
                    <div className={cn(!hideCurrentTaskPreview && "mt-2")}>
                      {taskPanelAddon}
                    </div>
                  ) : null}
                </div>

                {showLastTaskPreview ? (
                  <div className="rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5">
                    <div>
                      <p
                        className="break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-300/90"
                        title={codexLastTaskPreview ?? undefined}
                      >
                        <span className="font-medium text-zinc-200">
                          Last task:
                        </span>
                        <span className="ml-1 inline-flex items-center gap-1.5">
                          {hasNextTaskHint(codexLastTaskPreview) ? (
                            <NextTaskBadge />
                          ) : null}
                          <span>{displayLastTaskPreviewText}</span>
                        </span>
                      </p>
                      {lastTaskPreviewExcerpt?.truncated ? (
                        <button
                          type="button"
                          className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-200 transition-colors hover:text-cyan-100"
                          aria-expanded={lastTaskPreviewExpanded}
                          onClick={() =>
                            toggleTaskPreviewExpanded(
                              LAST_TASK_PREVIEW_EXPANSION_KEY,
                            )
                          }
                        >
                          {lastTaskPreviewExpanded ? "Show Less" : "View Full"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {hasSessionTaskRows ? (
                  <div className="mt-2 border-t border-white/10 pt-2">
                    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        className="inline-flex min-w-[13rem] flex-1 items-center justify-between gap-2 rounded-md border border-white/10 bg-black/25 px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 transition-colors hover:border-white/20 hover:bg-black/35"
                        aria-expanded={!sessionTasksCollapsed}
                        onClick={() =>
                          setSessionTasksCollapsed((current) => !current)
                        }
                      >
                        <span>CLI session tasks</span>
                        <span className="inline-flex items-center gap-1 text-zinc-300">
                          <span className="font-mono text-[10px]">
                            {sessionTaskRows.length}
                          </span>
                          <ChevronDown
                            className={cn(
                              "h-3.5 w-3.5 transition-transform duration-200",
                              sessionTasksCollapsed && "-rotate-90",
                            )}
                          />
                        </span>
                      </button>
                      <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-200">
                        {sessionTaskSummary.assignedCount} assigned
                      </span>
                      <span className="inline-flex h-6 items-center rounded-full border border-cyan-400/25 bg-cyan-500/10 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-cyan-200">
                        {sessionTaskSummary.waitingCount} waiting
                      </span>
                      {sessionTaskSummary.finishedCount > 0 ? (
                        <span className="inline-flex h-6 items-center rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-emerald-200">
                          {sessionTaskSummary.finishedCount} finished
                        </span>
                      ) : null}
                    </div>
                    {!sessionTasksCollapsed ? (
                      <ul className="space-y-1.5">
                        {sessionTaskRows.map((preview, index) => {
                          const sessionTaskState = sessionTaskStates[index] ?? "waiting";
                          const sessionTaskRowKey = `${preview.sessionKey}-${preview.ordinal}`;
                          const sessionTaskPreviewExcerpt = getTaskPreviewExcerpt(
                            preview.taskPreview,
                          );
                          const sessionTaskPreviewExpanded = isTaskPreviewExpanded(
                            sessionTaskRowKey,
                          );
                          const displaySessionTaskPreview =
                            sessionTaskPreviewExcerpt.truncated &&
                            !sessionTaskPreviewExpanded
                              ? sessionTaskPreviewExcerpt.text
                              : preview.taskPreview;
                          return (
                            <li
                              key={sessionTaskRowKey}
                              className={cn(
                                "relative overflow-hidden space-y-1.5 rounded-lg border border-white/10 bg-black/25 px-2.5 py-2 transition-all duration-200",
                                sessionTaskState === "waiting" &&
                                  "ring-1 ring-cyan-500/10 hover:border-cyan-300/30 hover:bg-black/35",
                                sessionTaskState === "thinking" &&
                                  "border-indigo-300/35 bg-[linear-gradient(155deg,rgba(34,211,238,0.1)_0%,rgba(99,102,241,0.24)_45%,rgba(15,23,42,0.9)_100%)] shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_10px_18px_rgba(6,24,44,0.45)] hover:border-cyan-300/40",
                                sessionTaskState === "finished" &&
                                  "border-emerald-400/22 bg-emerald-500/[0.1] hover:border-emerald-300/35",
                              )}
                            >
                              {sessionTaskState === "thinking" ? (
                                <div
                                  className="pointer-events-none absolute inset-0 -z-10"
                                  aria-hidden
                                >
                                  <div className="absolute -left-10 top-0 h-14 w-32 rounded-full bg-cyan-300/15 blur-2xl" />
                                  <div className="absolute right-0 top-4 h-14 w-32 rounded-full bg-indigo-300/20 blur-2xl" />
                                </div>
                              ) : null}
                              <div className="flex items-start justify-between gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-400">
                                <span>Session {preview.ordinal}</span>
                                <div className="flex min-w-0 flex-col items-end gap-1">
                                  {!preview.synthetic ? (
                                    <span
                                      className="max-w-[11rem] truncate font-mono text-zinc-500"
                                      title={preview.sessionKey}
                                    >
                                      {formatSessionKeyLabel(preview.sessionKey)}
                                    </span>
                                  ) : null}
                                  <SessionTaskStatePill
                                    taskPreview={preview.taskPreview}
                                    stateOverride={sessionTaskState}
                                    className="h-5 px-2 text-[9px]"
                                  />
                                </div>
                              </div>
                              <div title={preview.taskPreview}>
                                <div
                                  className={cn(
                                    "rounded-md px-2 py-1",
                                    sessionTaskState === "thinking" &&
                                      "border border-indigo-200/25 bg-black/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]",
                                  )}
                                >
                                  {sessionTaskState === "thinking" ? (
                                    <div className="mb-1 inline-flex h-4 items-center gap-1 rounded-full border border-indigo-200/30 bg-indigo-400/15 px-1.5 text-[8px] font-semibold uppercase tracking-[0.1em] text-indigo-100">
                                      Codex
                                    </div>
                                  ) : null}
                                  <span className="inline-flex items-center gap-1.5 break-words whitespace-pre-wrap text-xs leading-relaxed text-zinc-100/95">
                                    {hasNextTaskHint(preview.taskPreview) ? (
                                      <NextTaskBadge />
                                    ) : null}
                                    <span>{displaySessionTaskPreview}</span>
                                  </span>
                                </div>
                                {sessionTaskPreviewExcerpt.truncated ? (
                                  <button
                                    type="button"
                                    className="mt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-cyan-200 transition-colors hover:text-cyan-100"
                                    aria-expanded={sessionTaskPreviewExpanded}
                                    onClick={() =>
                                      toggleTaskPreviewExpanded(
                                        sessionTaskRowKey,
                                      )
                                    }
                                  >
                                    {sessionTaskPreviewExpanded
                                      ? "Show Less"
                                      : "View Full"}
                                  </button>
                                ) : null}
                                {sessionTaskState === "waiting" ? (
                                  <p className="mt-1 text-[10px] leading-relaxed text-cyan-200/85">
                                    {resolveWaitingTaskHelperText(
                                      preview.taskPreview,
                                    )}
                                  </p>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
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

          {/* Actions */}
          <div className="mt-3.5 border-t border-white/10 pt-3">
            <Button
              type="button"
              size="sm"
              variant="default"
              className={cn(
                "h-9 w-full justify-center gap-1.5 rounded-xl border border-emerald-400/35 bg-gradient-to-r from-emerald-500/22 via-emerald-500/16 to-cyan-500/14 px-3 text-sm font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.16)] transition-colors hover:from-emerald-500/30 hover:via-emerald-500/22 hover:to-cyan-500/20",
                canUseLocally
                  ? "text-emerald-700 hover:text-emerald-800 dark:text-emerald-200 dark:hover:text-emerald-100"
                  : "text-muted-foreground",
              )}
              disabled={useLocalButtonDisabled}
              title={useLocalButtonDisabledReason ?? undefined}
              aria-label={primaryActionAriaLabel}
              onClick={() => onAction?.(account, "useLocal")}
            >
              {primaryActionLabel}
            </Button>
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {hasSnapshotMismatch ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                  disabled={disableSecondaryActions}
                  onClick={() => onAction?.(account, "repairSnapshotReadd")}
                >
                  Re-add snapshot
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground"
                  disabled={disableSecondaryActions}
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
              disabled={disableSecondaryActions || !canUseLocally || useLocalBusy}
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
                  disabled={disableSecondaryActions}
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
                  disabled={disableSecondaryActions || !hasSessionInventory}
                  title={!hasSessionInventory ? "No tracked sessions" : undefined}
                  onClick={() => onAction?.(account, "sessions")}
                >
                  <ExternalLink className="h-3 w-3" />
                  Sessions
            </Button>
            <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 rounded-lg text-xs text-red-600 hover:bg-red-500/10 hover:text-red-700 disabled:pointer-events-none disabled:text-muted-foreground dark:text-red-400 dark:hover:text-red-300"
                  disabled={deleteBusy || disableSecondaryActions}
                  onClick={() => onAction?.(account, "delete")}
                >
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
            {status === "paused" && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 rounded-lg text-xs text-emerald-600 hover:bg-emerald-500/10 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-300"
                disabled={disableSecondaryActions}
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
                disabled={disableSecondaryActions}
                onClick={() => onAction?.(account, "reauth")}
              >
                <RotateCcw className="h-3 w-3" />
                Re-auth
              </Button>
            )}
            </div>
          </div>

          {liveQuotaDebug ? (
            <div className="mt-2.5">
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
                          saveQuotaDebugLogToFile(
                            account.accountId,
                            quotaDebugLogText,
                          )
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
          <div
            className="pointer-events-none absolute inset-0 bg-black/45 backdrop-blur-[1.5px]"
            aria-hidden
          />
          <div className="relative z-10 flex w-full max-w-[13rem] flex-col items-center gap-2 rounded-2xl border border-white/10 bg-black/75 px-4 py-3.5 text-center shadow-[0_20px_55px_rgba(0,0,0,0.55)] backdrop-blur-md">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-cyan-400/25 bg-cyan-400/10">
              <Lock className="h-4 w-4 text-cyan-200" aria-hidden />
            </div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-300">
              Locked account
            </p>
            <p
              className={cn(
                "max-w-full truncate font-mono text-xs text-zinc-200/90",
                lockedAccountIdentityBlurred && "privacy-blur",
              )}
              title={lockedAccountIdentity}
            >
              {lockedAccountIdentity}
            </p>
            <div className="mt-0.5 flex w-full items-center justify-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 rounded-lg border-white/15 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-100 hover:border-cyan-400/35 hover:bg-cyan-400/12 hover:text-cyan-100"
                onClick={handleUnlock}
              >
                Unlock
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1 rounded-lg border-red-500/25 bg-red-500/10 px-3 text-xs font-semibold text-red-200 hover:border-red-400/35 hover:bg-red-500/16 hover:text-red-100 disabled:pointer-events-none disabled:opacity-60"
                disabled={deleteBusy}
                onClick={() => onAction?.(account, "delete")}
              >
                <Trash2 className="h-3 w-3" />
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
