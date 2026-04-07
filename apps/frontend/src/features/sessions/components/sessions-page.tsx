import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Brain,
  MessageSquare,
  Pin,
  TerminalSquare,
  User,
  Wrench,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "@/lib/router-compat";
import { toast } from "sonner";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { getSessionEvents } from "@/features/sessions/api";
import { listStickySessions } from "@/features/sticky-sessions/api";
import { Badge } from "@/components/ui/badge";
import { usePrivacyStore } from "@/hooks/use-privacy";
import { cn } from "@/lib/utils";
import { getFreshDebugRawSampleCount } from "@/utils/account-working";
import { getErrorMessage } from "@/utils/errors";
import {
  formatLastUsageLabel,
  formatQuotaResetLabel,
  formatWindowLabel,
} from "@/utils/formatters";

const DEFAULT_LIMIT = 25;
const WAITING_FOR_NEW_TASK_LABEL = "Waiting for new task";
const TERMINAL_CONNECT_TIMEOUT_MS = 8_000;

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

type PromptTarget = {
  accountId: string;
  displayName: string;
  sessionKey: string | null;
};

const WATCH_EVENT_BADGE_STYLES: Record<
  string,
  {
    badgeClassName: string;
    cardClassName: string;
    dotClassName: string;
    Icon: typeof MessageSquare;
  }
> = {
  prompt: {
    badgeClassName: "border-cyan-500/35 bg-cyan-500/10 text-cyan-300",
    cardClassName: "border-cyan-500/20 bg-cyan-500/[0.05]",
    dotClassName: "border-cyan-500/45 bg-cyan-500/15 text-cyan-300",
    Icon: User,
  },
  answer: {
    badgeClassName: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
    cardClassName: "border-emerald-500/20 bg-emerald-500/[0.05]",
    dotClassName: "border-emerald-500/45 bg-emerald-500/15 text-emerald-300",
    Icon: Bot,
  },
  thinking: {
    badgeClassName: "border-indigo-500/35 bg-indigo-500/10 text-indigo-300",
    cardClassName: "border-indigo-500/20 bg-indigo-500/[0.05]",
    dotClassName: "border-indigo-500/45 bg-indigo-500/15 text-indigo-300",
    Icon: Brain,
  },
  tool: {
    badgeClassName: "border-violet-500/35 bg-violet-500/10 text-violet-300",
    cardClassName: "border-violet-500/20 bg-violet-500/[0.05]",
    dotClassName: "border-violet-500/45 bg-violet-500/15 text-violet-300",
    Icon: Wrench,
  },
  status: {
    badgeClassName: "border-amber-500/35 bg-amber-500/10 text-amber-300",
    cardClassName: "border-amber-500/20 bg-amber-500/[0.05]",
    dotClassName: "border-amber-500/45 bg-amber-500/15 text-amber-300",
    Icon: TerminalSquare,
  },
  event: {
    badgeClassName: "border-white/15 bg-white/[0.06] text-zinc-300",
    cardClassName: "border-white/10 bg-white/[0.02]",
    dotClassName: "border-white/20 bg-white/[0.08] text-zinc-300",
    Icon: MessageSquare,
  },
};

type TerminalSocketMessage =
  | {
      type: "ready";
      accountId?: string;
      snapshotName?: string;
      cwd?: string;
      command?: string;
    }
  | {
      type: "error";
      message?: string;
      code?: string;
    }
  | {
      type: string;
      [key: string]: unknown;
    };

function buildTerminalWebSocketUrl(accountId: string): string {
  if (typeof window === "undefined") {
    throw new Error("Terminal prompt can only be sent from the browser.");
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/ws/accounts/${encodeURIComponent(accountId)}/terminal/ws`;
}

async function sendPromptToAccountTerminal(args: {
  accountId: string;
  prompt: string;
}): Promise<void> {
  const prompt = args.prompt.trim();
  if (!prompt) {
    throw new Error("Prompt cannot be empty.");
  }

  await new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(buildTerminalWebSocketUrl(args.accountId));
    let settled = false;
    let promptSent = false;
    const timeoutId = window.setTimeout(() => {
      fail("Timed out while connecting to account terminal.");
    }, TERMINAL_CONNECT_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
    };

    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
          ws.close();
        }
      } catch {
        // ignore close errors from already-closed sockets
      }
      reject(new Error(message));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close(1000, "prompt-sent");
        }
      } catch {
        // ignore close errors from already-closed sockets
      }
      resolve();
    };

    ws.onmessage = (event) => {
      let message: TerminalSocketMessage;
      try {
        message = JSON.parse(event.data as string) as TerminalSocketMessage;
      } catch {
        return;
      }

      if (message.type === "error") {
        const errorMessage =
          typeof message.message === "string" && message.message.trim().length > 0
            ? message.message.trim()
            : "Terminal reported an error.";
        fail(errorMessage);
        return;
      }

      if (message.type !== "ready" || promptSent) {
        return;
      }

      try {
        ws.send(JSON.stringify({ type: "input", data: `${prompt}\n` }));
      } catch {
        fail("Failed to send prompt to terminal.");
        return;
      }

      promptSent = true;
      succeed();
    };

    ws.onerror = () => {
      fail("Unable to connect to account terminal.");
    };

    ws.onclose = () => {
      if (settled) {
        return;
      }
      fail(promptSent ? "Terminal closed before prompt confirmation." : "Terminal closed before prompt could be sent.");
    };
  });
}

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

function formatTimelineTimestamp(timestamp: string): string {
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) {
    return "Unknown time";
  }
  return new Date(parsed).toLocaleString();
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
  const [promptTarget, setPromptTarget] = useState<PromptTarget | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptSubmitting, setPromptSubmitting] = useState(false);

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
  const sessionEventsQuery = useQuery({
    queryKey: [
      "sticky-sessions",
      "session-events",
      {
        accountId: selectedAccountId,
        sessionKey: selectedSessionKey,
      },
    ],
    queryFn: () =>
      getSessionEvents({
        accountId: selectedAccountId as string,
        sessionKey: selectedSessionKey as string,
        limit: 160,
      }),
    enabled:
      watchMode
      && selectedSessionKey != null
      && selectedSessionKey.length > 0
      && selectedAccountId != null
      && selectedAccountId.length > 0,
    refetchInterval: 12_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const watchPromptTarget = useMemo<PromptTarget | null>(() => {
    if (!watchMode || !selectedSessionKey || !selectedAccountId) {
      return null;
    }
    return {
      accountId: selectedAccountId,
      displayName:
        selectedActivityRow?.displayName
        ?? selectedAccount?.displayName
        ?? selectedAccountId,
      sessionKey: selectedSessionKey,
    };
  }, [
    selectedAccount?.displayName,
    selectedAccountId,
    selectedActivityRow?.displayName,
    selectedSessionKey,
    watchMode,
  ]);

  const closePromptDialog = () => {
    if (promptSubmitting) {
      return;
    }
    setPromptTarget(null);
    setPromptDraft("");
  };

  const openPromptDialog = (target: PromptTarget) => {
    setPromptTarget(target);
    setPromptDraft("");
  };

  const submitPrompt = async () => {
    if (!promptTarget) {
      return;
    }
    const prompt = promptDraft.trim();
    if (!prompt) {
      toast.error("Enter a prompt first.");
      return;
    }

    setPromptSubmitting(true);
    try {
      await sendPromptToAccountTerminal({
        accountId: promptTarget.accountId,
        prompt,
      });
      toast.success(`Prompt sent to ${promptTarget.displayName}`);
      setPromptTarget(null);
      setPromptDraft("");
    } catch (caught) {
      toast.error(getErrorMessage(caught));
    } finally {
      setPromptSubmitting(false);
    }
  };

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
          Monitor Codex sessions by account and send prompts to account-scoped CLI terminals.
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
              <div className="flex items-center gap-2">
                {watchPromptTarget ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 px-3 text-xs"
                    onClick={() => openPromptDialog(watchPromptTarget)}
                  >
                    Prompt this session
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 px-3 text-xs"
                  onClick={() => {
                    const params = new URLSearchParams();
                    if (selectedAccountId) {
                      params.set("accountId", selectedAccountId);
                    }
                    navigate(`/sessions${params.toString() ? `?${params.toString()}` : ""}`);
                  }}
                >
                  Open full sessions list
                </Button>
              </div>
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
            <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">AI timeline</p>
                <p className="text-xs text-muted-foreground">
                  Prompt, assistant output, tool calls, and runtime events for this session.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-[0.08em]">
                  {sessionEventsQuery.data?.events.length ?? 0} events
                </Badge>
                {sessionEventsQuery.data?.truncated ? (
                  <Badge variant="outline" className="text-[10px] font-medium uppercase tracking-[0.08em] text-amber-300 border-amber-500/35 bg-amber-500/10">
                    Truncated
                  </Badge>
                ) : null}
              </div>
            </div>
            <div className="p-2">
              {sessionEventsQuery.isLoading ? (
                <div className="space-y-2 rounded-lg border bg-[#020812] p-3">
                  <div className="h-3 w-56 rounded bg-cyan-500/15" />
                  <div className="h-14 rounded bg-cyan-500/[0.08]" />
                  <div className="h-14 rounded bg-cyan-500/[0.06]" />
                </div>
              ) : sessionEventsQuery.isError ? (
                <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-200">
                  Failed to load session timeline: {getErrorMessage(sessionEventsQuery.error)}
                </p>
              ) : sessionEventsQuery.data?.events.length ? (
                <div className="space-y-2 rounded-lg border bg-[#020812] p-2">
                  {sessionEventsQuery.data?.sourceFile ? (
                    <p className="rounded border border-white/10 bg-white/[0.02] px-2 py-1 font-mono text-[10px] text-zinc-400">
                      Source: {sessionEventsQuery.data.sourceFile}
                    </p>
                  ) : null}
                  <ol className="max-h-96 space-y-0.5 overflow-y-auto">
                  {sessionEventsQuery.data.events.map((event, index) => {
                    const eventStyle =
                      WATCH_EVENT_BADGE_STYLES[event.kind]
                      ?? WATCH_EVENT_BADGE_STYLES.event;
                    const Icon = eventStyle.Icon;
                    return (
                      <li
                        key={`${event.timestamp}-${event.kind}-${event.rawType ?? "event"}-${index}`}
                        className="relative pl-7"
                      >
                        {index < sessionEventsQuery.data.events.length - 1 ? (
                          <span
                            aria-hidden="true"
                            className="absolute bottom-[-8px] left-[0.78rem] top-6 w-px bg-white/10"
                          />
                        ) : null}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "absolute left-0 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full border",
                            eventStyle.dotClassName,
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div
                          className={cn(
                            "rounded-lg border px-2.5 py-2",
                            eventStyle.cardClassName,
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={cn(
                              "inline-flex h-5 items-center rounded-md border px-2 text-[10px] font-semibold uppercase tracking-[0.08em]",
                              eventStyle.badgeClassName,
                            )}
                          >
                            {event.kind}
                          </span>
                          <span className="text-[10px] text-zinc-500">
                            {formatTimelineTimestamp(event.timestamp)}
                          </span>
                          <span className="text-[10px] font-semibold text-zinc-200">
                            {event.title}
                          </span>
                          {event.rawType ? (
                            <span className="text-[10px] text-zinc-500">
                              {event.rawType}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-cyan-100">
                          {event.text}
                        </p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
                </div>
              ) : (
                <p className="rounded-lg border bg-[#020812] px-3 py-2 text-[11px] text-cyan-100/80">
                  No prompt/answer timeline was captured for this session yet.
                </p>
              )}
            </div>
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
                        <TableHead className="text-right text-[11px] uppercase tracking-wider text-muted-foreground/80">Action</TableHead>
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
                            className="max-w-[28rem] whitespace-normal break-words text-xs text-muted-foreground"
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
                          <TableCell className="text-right">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-[11px]"
                              onClick={() =>
                                openPromptDialog({
                                  accountId: row.accountId,
                                  displayName: row.displayName,
                                  sessionKey: row.identity,
                                })
                              }
                            >
                              Prompt
                            </Button>
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

      <Dialog
        open={promptTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            closePromptDialog();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Send prompt to CLI</DialogTitle>
            <DialogDescription>
              This opens an account-scoped Codex terminal session and sends your prompt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
              Target account:{" "}
              <span className="font-medium text-foreground">
                {promptTarget?.displayName ?? "—"}
              </span>
              {promptTarget?.sessionKey ? (
                <span className="ml-2 font-mono text-[11px] text-muted-foreground">
                  ({promptTarget.sessionKey})
                </span>
              ) : null}
            </div>
            <label className="block space-y-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Prompt
              </span>
              <textarea
                value={promptDraft}
                onChange={(event) => setPromptDraft(event.target.value)}
                rows={6}
                className="flex min-h-28 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
                placeholder="Describe what Codex should do for this account..."
                disabled={promptSubmitting}
              />
            </label>
            <p className="text-xs text-muted-foreground">
              Tip: use clear, single-task prompts. This action is scoped to the selected account snapshot.
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closePromptDialog}
              disabled={promptSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                void submitPrompt();
              }}
              disabled={promptSubmitting || promptDraft.trim().length === 0}
            >
              {promptSubmitting ? "Sending…" : "Send prompt"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
