import { useEffect, useMemo, useRef, useState } from "react";
import { Pin } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router-compat";

import { EmptyState } from "@/components/empty-state";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PaginationControls } from "@/features/dashboard/components/filters/pagination-controls";
import { getDashboardOverview } from "@/features/dashboard/api";
import type { AccountSummary } from "@/features/dashboard/schemas";
import { listStickySessions } from "@/features/sticky-sessions/api";
import { Badge } from "@/components/ui/badge";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { cn } from "@/lib/utils";
import { getFreshDebugRawSampleCount } from "@/utils/account-working";
import {
  formatLastUsageLabel,
  formatQuotaResetLabel,
  formatWindowLabel,
} from "@/utils/formatters";

const DEFAULT_LIMIT = 25;
const WAITING_FOR_NEW_TASK_LABEL = "Waiting for new task";

type ProgressTone = "upToDate" | "muted" | "pending";

type ActivityRow = {
  rowKey: string;
  accountId: string;
  displayName: string;
  identity: string;
  sourceLabel: string;
  status: "live" | "idle";
  currentTask: string | null;
  lastTask: string | null;
  progressLabel: string;
  progressTone: ProgressTone;
  codexSessionCount: number;
  sortTimestampMs: number;
};

function resolveProgressDisplay(
  isLive: boolean,
  recordedAt: string | null | undefined,
): { label: string; tone: ProgressTone } {
  if (isLive) {
    return { label: "Up to date", tone: "upToDate" };
  }

  const lastSeenLabel = formatLastUsageLabel(recordedAt);
  if (!lastSeenLabel) {
    return { label: "telemetry pending", tone: "pending" };
  }

  const normalized = lastSeenLabel.trim().toLowerCase();
  if (normalized === "last seen now" || /\b0m ago$/.test(normalized)) {
    return { label: "Up to date", tone: "upToDate" };
  }

  return { label: lastSeenLabel, tone: "muted" };
}

function resolveLatestUsageTimestamp(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): string | null {
  const primaryMs = primary ? Date.parse(primary) : Number.NaN;
  const secondaryMs = secondary ? Date.parse(secondary) : Number.NaN;
  const hasPrimary = Number.isFinite(primaryMs) && primaryMs > 0;
  const hasSecondary = Number.isFinite(secondaryMs) && secondaryMs > 0;

  if (!hasPrimary && !hasSecondary) {
    return null;
  }
  if (!hasPrimary) {
    return secondary ?? null;
  }
  if (!hasSecondary) {
    return primary ?? null;
  }

  return primaryMs >= secondaryMs ? primary ?? null : secondary ?? null;
}

function parseIsoToMs(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return parsed;
}

function sortActivityRowsByAccount(rows: ActivityRow[]): ActivityRow[] {
  return [...rows].sort((left, right) => {
    const displayNameOrder = left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (displayNameOrder !== 0) {
      return displayNameOrder;
    }

    const accountIdOrder = left.accountId.localeCompare(right.accountId, undefined, {
      sensitivity: "base",
      numeric: true,
    });
    if (accountIdOrder !== 0) {
      return accountIdOrder;
    }

    if (left.status !== right.status) {
      return left.status === "live" ? -1 : 1;
    }

    if (left.sortTimestampMs !== right.sortTimestampMs) {
      return right.sortTimestampMs - left.sortTimestampMs;
    }

    return left.identity.localeCompare(right.identity, undefined, {
      sensitivity: "base",
      numeric: true,
    });
  });
}

function formatTrackedSessionLabel(sessionCount: number): string {
  return `${sessionCount} tracked ${sessionCount === 1 ? "session" : "sessions"}`;
}

function buildFallbackSourceLabel({
  trackedSessionCount,
  freshSampleCount,
  hasLiveSession,
}: {
  trackedSessionCount: number;
  freshSampleCount: number;
  hasLiveSession: boolean;
}): string {
  if (trackedSessionCount > 0 && freshSampleCount > 0) {
    return `${formatTrackedSessionLabel(trackedSessionCount)} · ${freshSampleCount} fresh ${freshSampleCount === 1 ? "sample" : "samples"}`;
  }
  if (trackedSessionCount > 0) {
    return formatTrackedSessionLabel(trackedSessionCount);
  }
  if (freshSampleCount > 0 && hasLiveSession) {
    return `${freshSampleCount} fresh ${freshSampleCount === 1 ? "sample" : "samples"} · live heartbeat`;
  }
  if (freshSampleCount > 0) {
    return `${freshSampleCount} fresh ${freshSampleCount === 1 ? "sample" : "samples"}`;
  }
  if (hasLiveSession) {
    return "Live session heartbeat";
  }
  return "Session telemetry pending";
}

function formatQuotaPercent(value: number | null | undefined): string {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "--";
  }
  const clamped = Math.max(0, Math.min(100, value));
  return `${Math.round(clamped)}%`;
}

type QuotaTone = "healthy" | "warning" | "critical" | "unknown";

function resolveQuotaTone(value: number | null | undefined): QuotaTone {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "unknown";
  }
  const clamped = Math.max(0, Math.min(100, value));
  if (clamped >= 70) {
    return "healthy";
  }
  if (clamped >= 30) {
    return "warning";
  }
  return "critical";
}

function quotaFillClassName(tone: QuotaTone): string {
  if (tone === "healthy") {
    return "bg-gradient-to-r from-emerald-500 via-emerald-400 to-cyan-400";
  }
  if (tone === "warning") {
    return "bg-gradient-to-r from-amber-500 via-orange-400 to-yellow-300";
  }
  if (tone === "critical") {
    return "bg-gradient-to-r from-rose-600 via-red-500 to-orange-400";
  }
  return "bg-muted-foreground/45";
}

function buildWatchLogLines({
  accountId,
  sessionKey,
  sourceLabel,
  status,
  taskPreview,
  taskUpdatedAt,
  liveQuotaDebug,
}: {
  accountId: string;
  sessionKey: string;
  sourceLabel: string;
  status: "live" | "idle";
  taskPreview: string;
  taskUpdatedAt: string | null | undefined;
  liveQuotaDebug: AccountSummary["liveQuotaDebug"] | null | undefined;
}): string[] {
  const lines: string[] = [
    `$ account=${accountId}`,
    `$ session=${sessionKey}`,
    `$ source=${sourceLabel}`,
    `$ state=${status}`,
    `$ task_updated_at=${taskUpdatedAt ?? "unknown"}`,
    `$ task_preview=${taskPreview}`,
  ];

  const rawSamples = liveQuotaDebug?.rawSamples ?? [];
  const scopedSamples = rawSamples.filter(
    (sample) =>
      sample.source.includes(sessionKey) ||
      (sample.snapshotName != null && sample.snapshotName.trim().length > 0),
  );
  const debugSamples = (scopedSamples.length > 0 ? scopedSamples : rawSamples).slice(0, 8);
  for (const [index, sample] of debugSamples.entries()) {
    lines.push(
      `$ quota-sample#${index + 1} src=${sample.source} 5h=${formatQuotaPercent(sample.primary?.remainingPercent)} weekly=${formatQuotaPercent(sample.secondary?.remainingPercent)}`,
    );
  }
  return lines;
}

export function SessionsPage() {
  const navigate = useNavigate();
  const [offset, setOffset] = useState(0);
  const [limit, setLimit] = useState(DEFAULT_LIMIT);
  const [searchParams] = useSearchParams();
  const blurred = usePrivacyStore((s) => s.blurred);
  const selectedAccountId = searchParams.get("accountId");
  const selectedSessionKey = searchParams.get("sessionKey")?.trim() ?? null;
  const watchMode = searchParams.get("view")?.trim().toLowerCase() === "watch";
  const focusedSessionRowRef = useRef<HTMLTableRowElement | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["sticky-sessions", "codex-sessions", { offset, limit, activeOnly: false }],
    queryFn: () =>
      listStickySessions({
        kind: "codex_session",
        staleOnly: false,
        activeOnly: false,
        offset,
        limit,
      }),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const overviewQuery = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });

  const entries = sessionsQuery.data?.entries;
  const hasMore = sessionsQuery.data?.hasMore ?? false;

  const stickyActivityRows = useMemo<ActivityRow[]>(() => {
    const rows = (entries ?? []).map((entry) => {
      const progress = resolveProgressDisplay(entry.isActive, entry.taskUpdatedAt ?? entry.updatedAt);
      return {
        rowKey: `sticky:${entry.key}`,
        accountId: entry.accountId,
        displayName: entry.displayName,
        identity: entry.key,
        sourceLabel: "Sticky mapping",
        status: entry.isActive ? ("live" as const) : ("idle" as const),
        currentTask: entry.taskPreview?.trim() || null,
        lastTask: null,
        progressLabel: progress.label,
        progressTone: progress.tone,
        codexSessionCount: 1,
        sortTimestampMs: parseIsoToMs(entry.taskUpdatedAt ?? entry.updatedAt),
      };
    });

    const scopedRows = selectedAccountId
      ? rows.filter((row) => row.accountId === selectedAccountId)
      : rows;

    return sortActivityRowsByAccount(scopedRows);
  }, [entries, selectedAccountId]);
  const fallbackActivityRows = useMemo<ActivityRow[]>(() => {
    const rows = (overviewQuery.data?.accounts ?? [])
      .map((account) => {
        const trackedSessionCount = Math.max(
          account.codexTrackedSessionCount ?? 0,
          account.codexSessionCount ?? 0,
          0,
        );
        const freshSampleCount = getFreshDebugRawSampleCount(account);
        const hasLiveSession = Boolean(
          account.codexAuth?.hasLiveSession
            ?? (account.codexLiveSessionCount ?? 0) > 0,
        );
        const latestUsageTimestamp = resolveLatestUsageTimestamp(
          account.lastUsageRecordedAtPrimary,
          account.lastUsageRecordedAtSecondary,
        );
        const detectedSessionCount =
          trackedSessionCount > 0
            ? trackedSessionCount
            : hasLiveSession || freshSampleCount > 0
              ? 1
              : 0;
        const progress = resolveProgressDisplay(
          hasLiveSession,
          latestUsageTimestamp,
        );
        return {
          rowKey: `overview:${account.accountId}`,
          accountId: account.accountId,
          displayName: account.displayName,
          identity: "Dashboard overview",
          sourceLabel: buildFallbackSourceLabel({
            trackedSessionCount,
            freshSampleCount,
            hasLiveSession,
          }),
          status: hasLiveSession ? ("live" as const) : ("idle" as const),
          currentTask: account.codexCurrentTaskPreview?.trim() || null,
          lastTask: account.codexLastTaskPreview?.trim() || null,
          progressLabel: progress.label,
          progressTone: progress.tone,
          codexSessionCount: detectedSessionCount,
          sortTimestampMs: parseIsoToMs(latestUsageTimestamp),
        };
      })
      .filter((row) => row.codexSessionCount > 0);

    const scopedRows = selectedAccountId
      ? rows.filter((row) => row.accountId === selectedAccountId)
      : rows;

    return sortActivityRowsByAccount(scopedRows);
  }, [overviewQuery.data?.accounts, selectedAccountId]);
  const shouldUseFallbackOverview = stickyActivityRows.length === 0 && fallbackActivityRows.length > 0;
  const activityRows = shouldUseFallbackOverview ? fallbackActivityRows : stickyActivityRows;
  const unmappedCliSessions = sessionsQuery.data?.unmappedCliSessions ?? [];
  const hasUnmappedCliRows = unmappedCliSessions.length > 0;
  const stickyAccountCount = new Set(stickyActivityRows.map((row) => row.accountId)).size;

  const total = shouldUseFallbackOverview
    ? fallbackActivityRows.reduce((sum, row) => sum + row.codexSessionCount, 0)
    : stickyActivityRows.length;
  const accountCount = shouldUseFallbackOverview ? fallbackActivityRows.length : stickyAccountCount;
  const hasSessionRows = total > 0;
  const waitingForOverviewFallback = (sessionsQuery.data?.total ?? 0) === 0 && overviewQuery.isLoading && !overviewQuery.data;
  const isLoading = (sessionsQuery.isLoading && !sessionsQuery.data) || waitingForOverviewFallback;
  const hasFocusedSessionRow = selectedSessionKey
    ? activityRows.some((row) => row.identity === selectedSessionKey)
    : false;
  const selectedStickyEntry = useMemo(
    () =>
      selectedSessionKey
        ? (entries ?? []).find(
            (entry) =>
              entry.key === selectedSessionKey &&
              (!selectedAccountId || entry.accountId === selectedAccountId),
          ) ?? null
        : null,
    [entries, selectedAccountId, selectedSessionKey],
  );
  const selectedActivityRow = useMemo(
    () =>
      selectedSessionKey
        ? activityRows.find((row) => row.identity === selectedSessionKey) ?? null
        : null,
    [activityRows, selectedSessionKey],
  );
  const selectedAccount = useMemo(
    () =>
      selectedAccountId
        ? overviewQuery.data?.accounts.find(
            (account) => account.accountId === selectedAccountId,
          ) ?? null
        : null,
    [overviewQuery.data?.accounts, selectedAccountId],
  );
  const emptyDescription = selectedAccountId
    ? "No Codex sessions were found for the selected account."
    : "Codex sessions will appear here once routed requests create sticky session mappings.";
  const watchTaskPreview =
    selectedStickyEntry?.taskPreview?.trim() ||
    selectedActivityRow?.currentTask ||
    WAITING_FOR_NEW_TASK_LABEL;
  const watchSourceLabel =
    selectedActivityRow?.sourceLabel ??
    (selectedStickyEntry ? "Sticky mapping" : "Dashboard overview");
  const watchStatus = selectedActivityRow?.status ?? "idle";
  const watchPrimaryPercent = selectedAccount?.usage?.primaryRemainingPercent ?? null;
  const watchSecondaryPercent =
    selectedAccount?.usage?.secondaryRemainingPercent ?? null;
  const watchPrimaryLabel = formatWindowLabel(
    "primary",
    selectedAccount?.windowMinutesPrimary,
  );
  const watchPrimaryReset = formatQuotaResetLabel(selectedAccount?.resetAtPrimary);
  const watchSecondaryReset = formatQuotaResetLabel(selectedAccount?.resetAtSecondary);
  const watchLogLines = useMemo(() => {
    if (!selectedSessionKey || !selectedAccountId) {
      return [];
    }
    return buildWatchLogLines({
      accountId: selectedAccountId,
      sessionKey: selectedSessionKey,
      sourceLabel: watchSourceLabel,
      status: watchStatus,
      taskPreview: watchTaskPreview,
      taskUpdatedAt: selectedStickyEntry?.taskUpdatedAt ?? null,
      liveQuotaDebug: selectedAccount?.liveQuotaDebug,
    });
  }, [
    selectedAccount?.liveQuotaDebug,
    selectedAccountId,
    selectedSessionKey,
    selectedStickyEntry?.taskUpdatedAt,
    watchSourceLabel,
    watchStatus,
    watchTaskPreview,
  ]);

  useEffect(() => {
    if (!selectedSessionKey || !hasFocusedSessionRow) {
      return;
    }
    const focusedRow = focusedSessionRowRef.current;
    if (!focusedRow || typeof focusedRow.scrollIntoView !== "function") {
      return;
    }
    focusedRow.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
  }, [hasFocusedSessionRow, selectedSessionKey]);

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sessions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Read-only Codex sessions grouped by account.
        </p>
      </div>

      {isLoading ? (
        <div className="py-8">
          <SpinnerBlock />
        </div>
      ) : watchMode && selectedSessionKey ? (
        <section className="space-y-4">
          <div className="rounded-xl border bg-card px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-semibold">Session watch logs</p>
                <p className="text-xs text-muted-foreground">
                  Session-only token status and scoped logs.
                </p>
              </div>
              <button
                type="button"
                className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => {
                  const params = new URLSearchParams();
                  if (selectedAccountId) {
                    params.set("accountId", selectedAccountId);
                  }
                  navigate(`/sessions${params.toString() ? `?${params.toString()}` : ""}`);
                }}
              >
                Open full sessions list
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="text-[11px] font-mono">
                {selectedAccountId ?? "unknown-account"}
              </Badge>
              <Badge variant="outline" className="text-[11px] font-mono">
                {selectedSessionKey}
              </Badge>
              <Badge
                variant={watchStatus === "live" ? "secondary" : "outline"}
                className="text-[11px]"
              >
                {watchStatus === "live" ? "Live" : "Idle"}
              </Badge>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {[
              {
                label: watchPrimaryLabel,
                percent: watchPrimaryPercent,
                resetLabel: watchPrimaryReset,
              },
              {
                label: "Weekly",
                percent: watchSecondaryPercent,
                resetLabel: watchSecondaryReset,
              },
            ].map((quota) => {
              const tone = resolveQuotaTone(quota.percent);
              const clampedPercent =
                typeof quota.percent === "number" && !Number.isNaN(quota.percent)
                  ? Math.max(0, Math.min(100, quota.percent))
                  : 0;
              return (
                <div key={quota.label} className="rounded-xl border bg-card px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                      {quota.label}
                    </p>
                    <p className="text-xs font-semibold">{formatQuotaPercent(quota.percent)}</p>
                  </div>
                  <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted/50">
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-300",
                        quotaFillClassName(tone),
                      )}
                      style={{ width: `${clampedPercent}%` }}
                    />
                  </div>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Reset: {quota.resetLabel}
                  </p>
                </div>
              );
            })}
          </div>

          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Current task
            </p>
            <p className="mt-1 text-sm">{watchTaskPreview}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Source: {watchSourceLabel}
            </p>
          </div>

          <div className="rounded-xl border bg-card">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold">Session logs</p>
            </div>
            <div className="p-2">
              <ol className="max-h-72 overflow-y-auto rounded-lg border bg-[#020812] p-2 font-mono text-[11px] leading-5 text-cyan-100">
                {watchLogLines.map((line, lineIndex) => (
                  <li
                    key={`${selectedSessionKey}-watch-log-${lineIndex}`}
                    className="grid grid-cols-[2.2rem_minmax(0,1fr)] gap-2 rounded-sm px-1.5 even:bg-cyan-500/[0.06]"
                  >
                    <span className="select-none text-right text-cyan-400/55">
                      {String(lineIndex + 1).padStart(2, "0")}
                    </span>
                    <span className="break-all">{line}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>
      ) : !hasSessionRows && !hasUnmappedCliRows ? (
        <EmptyState
          icon={Pin}
          title="No Codex sessions"
          description={emptyDescription}
        />
      ) : (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Codex sessions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{total}</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Accounts with sessions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">{accountCount}</p>
            </div>
            <div className="rounded-xl border bg-card px-4 py-3">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Unmapped CLI sessions</p>
              <p className="mt-1 text-xl font-semibold tabular-nums">
                {unmappedCliSessions.reduce((sum, item) => sum + item.totalSessionCount, 0)}
              </p>
            </div>
          </section>

          <section className="space-y-4">
            {selectedSessionKey ? (
              <div
                className={cn(
                  "rounded-xl border px-4 py-3 text-xs",
                  hasFocusedSessionRow
                    ? "border-cyan-500/35 bg-cyan-500/10 text-cyan-700 dark:text-cyan-200"
                    : "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200",
                )}
              >
                {hasFocusedSessionRow ? (
                  <p>
                    Focused session:{" "}
                    <span className="font-mono font-semibold">
                      {selectedSessionKey}
                    </span>
                  </p>
                ) : (
                  <p>
                    Session{" "}
                    <span className="font-mono font-semibold">
                      {selectedSessionKey}
                    </span>{" "}
                    was not found on this page.
                  </p>
                )}
              </div>
            ) : null}
            {hasSessionRows ? (
              <div className="rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Session activity</p>
                    <p className="text-xs text-muted-foreground">
                      {shouldUseFallbackOverview
                        ? "Sticky mappings are empty, so this view falls back to dashboard overview telemetry."
                        : "Sticky session mappings provide per-session activity telemetry."}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Account</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Session / source</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Status</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Current task</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Progress</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {activityRows.map((row) => {
                        const isFocusedSessionRow =
                          selectedSessionKey != null &&
                          row.identity === selectedSessionKey;
                        return (
                        <TableRow
                          key={row.rowKey}
                          ref={isFocusedSessionRow ? focusedSessionRowRef : null}
                          className={cn(
                            isFocusedSessionRow &&
                              "bg-cyan-500/[0.08] ring-1 ring-cyan-500/30",
                          )}
                        >
                          <TableCell>
                            <p className="text-sm font-medium">
                              {blurred ? <span className="privacy-blur">{row.displayName}</span> : row.displayName}
                            </p>
                            <p className="font-mono text-[11px] text-muted-foreground">{row.accountId}</p>
                          </TableCell>
                          <TableCell>
                            <p
                              className={cn(
                                "max-w-[28rem] truncate text-xs",
                                row.sourceLabel === "Sticky mapping" && "font-mono",
                              )}
                              title={row.identity}
                            >
                              {row.identity}
                            </p>
                            <p className="text-[11px] text-muted-foreground">{row.sourceLabel}</p>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={row.status === "live" ? "secondary" : "outline"}
                              className={cn(
                                "text-[11px]",
                                row.status === "live" && "font-semibold text-emerald-700 dark:text-emerald-300",
                              )}
                            >
                              {row.status === "live" ? "Live" : "Idle"}
                            </Badge>
                          </TableCell>
                          <TableCell
                            className="max-w-[28rem] text-xs text-muted-foreground"
                            title={row.currentTask ?? row.lastTask ?? undefined}
                          >
                            <div className="space-y-1">
                              <p>{row.currentTask ?? "—"}</p>
                              {row.currentTask === WAITING_FOR_NEW_TASK_LABEL && row.lastTask ? (
                                <p
                                  className="break-words whitespace-pre-wrap text-[11px] text-muted-foreground/80"
                                  title={row.lastTask}
                                >
                                  <span className="font-medium text-muted-foreground">Last task:</span>{" "}
                                  {row.lastTask}
                                </p>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "text-xs",
                              row.progressTone === "upToDate" && "font-medium text-emerald-600 dark:text-emerald-300",
                              row.progressTone === "pending" && "text-muted-foreground",
                              row.progressTone === "muted" && "text-muted-foreground",
                            )}
                          >
                            {row.progressLabel}
                          </TableCell>
                        </TableRow>
                      )})}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            {hasUnmappedCliRows ? (
              <div className="rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold">Unmapped CLI sessions</p>
                    <p className="text-xs text-muted-foreground">
                      Active Codex CLI sessions detected by snapshot, but not matched to any account.
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Snapshot</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Total</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Process</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Runtime</TableHead>
                        <TableHead className="text-[11px] uppercase tracking-wider text-muted-foreground/80">Reason</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unmappedCliSessions.map((session) => (
                        <TableRow key={`unmapped:${session.snapshotName}`}>
                          <TableCell>
                            <p className="font-mono text-xs">{session.snapshotName}</p>
                          </TableCell>
                          <TableCell className="text-xs">{session.totalSessionCount}</TableCell>
                          <TableCell className="text-xs">{session.processSessionCount}</TableCell>
                          <TableCell className="text-xs">{session.runtimeSessionCount}</TableCell>
                          <TableCell className="text-xs text-muted-foreground">{session.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            {hasSessionRows && !shouldUseFallbackOverview ? (
              <div className="flex justify-end pt-1">
                <PaginationControls
                  total={sessionsQuery.data?.total ?? 0}
                  limit={limit}
                  offset={offset}
                  hasMore={hasMore}
                  onLimitChange={(nextLimit) => {
                    setLimit(nextLimit);
                    setOffset(0);
                  }}
                  onOffsetChange={setOffset}
                />
              </div>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
