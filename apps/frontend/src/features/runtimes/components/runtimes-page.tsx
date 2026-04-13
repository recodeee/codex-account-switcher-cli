import { useMemo, useState } from "react";
import {
  CheckCircle2,
  Info,
  Server,
  UserRound,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { SpinnerBlock } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { AccountSummary } from "@/features/accounts/schemas";
import { getRequestLogs } from "@/features/dashboard/api";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import type { RequestLog } from "@/features/dashboard/schemas";
import { listStickySessions } from "@/features/sticky-sessions/api";
import { cn } from "@/lib/utils";
import { hasActiveCliSessionSignal } from "@/utils/account-working";
import { formatCompactNumber, formatLastUsageLabel } from "@/utils/formatters";
import { resolveFallbackDailyUsageWeights } from "./runtime-daily-usage";
import {
  normalizeRuntimeTaskPreview,
  resolveRuntimeTaskPreviews,
} from "./runtime-task-previews";

type RuntimeScope = "mine" | "all";
type UsageWindow = "7d" | "30d" | "90d";

type RuntimeRow = {
  runtimeId: string;
  accountId: string | null;
  name: string;
  provider: "codex" | "openclaw";
  owner: string;
  snapshotName: string;
  status: "online" | "offline";
  mode: "local";
  sessionCount: number;
  trackedSessionCount: number;
  lastSeenAt: string | null;
  currentTask: string | null;
  currentTasks: string[];
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  activityTimestamps: string[];
  metadata: Record<string, string | number | boolean | null>;
  isUnmapped: boolean;
};

type StickyAccountSessionStats = {
  activeCount: number;
  totalCount: number;
  timestamps: string[];
};

type DailyTokenPoint = {
  key: string;
  label: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
};

type ActivityHeatmapRow = {
  key: string;
  label: string;
  levels: number[];
};

type HourlyDistributionEntry = {
  hour: number;
  label: string;
  requestCount: number;
  totalTokens: number;
  hasTokenData: boolean;
};

type DailyUsageTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload?: DailyTokenPoint }>;
  label?: string;
};

const DAY_MS = 86_400_000;
const OPENCLAW_PROVIDER_MATCHER = /\bopenclaw\b|\bopencl\b|\boclaw\b/i;

function resolveRuntimeProvider(...values: Array<string | null | undefined>): "codex" | "openclaw" {
  return values.some((value) => value && OPENCLAW_PROVIDER_MATCHER.test(value)) ? "openclaw" : "codex";
}

function getRuntimeDisplayName(provider: "codex" | "openclaw") {
  return provider === "openclaw" ? "Openclaw" : "Codex";
}

function resolveWindowDays(window: UsageWindow) {
  if (window === "7d") return 7;
  if (window === "30d") return 30;
  return 90;
}

function startOfDayMs(value: number) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatMonthDayLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "numeric",
    day: "numeric",
  });
}

function formatTokenMillions(value: number) {
  const safeValue = Math.max(0, Math.round(value));
  if (safeValue === 0) {
    return "0";
  }
  if (safeValue >= 1_000_000_000) {
    return `${(safeValue / 1_000_000_000).toFixed(2)}B`;
  }
  if (safeValue >= 1_000_000) {
    return `${(safeValue / 1_000_000).toFixed(1)}M`;
  }
  if (safeValue >= 1_000) {
    return `${(safeValue / 1_000).toFixed(1)}K`;
  }
  return `${safeValue}`;
}

function distributeTotalAcrossDays(total: number, weights: number[]) {
  if (total <= 0 || weights.length === 0) {
    return new Array<number>(weights.length).fill(0);
  }
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const distributed = weights.map((weight) => Math.round((total * weight) / Math.max(totalWeight, 1)));
  const distributedSum = distributed.reduce((sum, value) => sum + value, 0);
  const delta = total - distributedSum;
  if (delta !== 0) {
    distributed[distributed.length - 1] += delta;
  }
  return distributed;
}

function resolveLatestTimestamp(...values: Array<string | null | undefined>): string | null {
  let latestMs = Number.NaN;
  let latestValue: string | null = null;
  for (const value of values) {
    if (!value) {
      continue;
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) {
      continue;
    }
    if (!Number.isFinite(latestMs) || parsed > latestMs) {
      latestMs = parsed;
      latestValue = value;
    }
  }
  return latestValue;
}

function buildStickyStats(entries: Awaited<ReturnType<typeof listStickySessions>>["entries"]) {
  const stats = new Map<string, StickyAccountSessionStats>();
  for (const entry of entries) {
    const previous = stats.get(entry.accountId) ?? {
      activeCount: 0,
      totalCount: 0,
      timestamps: [],
    };
    previous.totalCount += 1;
    if (entry.isActive) {
      previous.activeCount += 1;
    }
    if (entry.taskUpdatedAt) {
      previous.timestamps.push(entry.taskUpdatedAt);
    }
    previous.timestamps.push(entry.updatedAt);
    stats.set(entry.accountId, previous);
  }
  return stats;
}

function buildRuntimeRows(
  accounts: AccountSummary[] | undefined,
  sticky: Awaited<ReturnType<typeof listStickySessions>> | undefined,
): RuntimeRow[] {
  const accountRows: RuntimeRow[] = [];
  const stickyStats = buildStickyStats(sticky?.entries ?? []);
  const nowMs = Date.now();

  for (const account of accounts ?? []) {
    if (!(account.codexAuth?.hasSnapshot ?? false)) {
      continue;
    }

    const stickyByAccount = stickyStats.get(account.accountId);
    const stickySessionCount = stickyByAccount?.activeCount ?? 0;
    const activeSignal = hasActiveCliSessionSignal(account, nowMs);
    const liveSessionCount = Math.max(
      stickySessionCount,
      account.codexLiveSessionCount ?? 0,
      activeSignal ? 1 : 0,
    );
    const trackedSessionCount = Math.max(
      account.codexTrackedSessionCount ?? 0,
      account.codexSessionCount ?? 0,
      stickyByAccount?.totalCount ?? 0,
    );
    const sessionCount = Math.max(
      liveSessionCount,
      trackedSessionCount,
    );
    const status = sessionCount > 0 ? "online" : "offline";
    const snapshotName =
      account.codexAuth?.snapshotName ??
      account.codexAuth?.expectedSnapshotName ??
      account.email;
    const previewFromAccount = normalizeRuntimeTaskPreview(
      account.codexCurrentTaskPreview,
    );
    const previewFromSession = normalizeRuntimeTaskPreview(
      account.codexSessionTaskPreviews?.[0]?.taskPreview,
    );
    const currentTasks = resolveRuntimeTaskPreviews(account, liveSessionCount);
    const currentTask = currentTasks[0] ?? null;
    const provider = resolveRuntimeProvider(
      account.codexAuth?.snapshotName,
      account.codexAuth?.expectedSnapshotName,
      account.email,
      account.displayName,
      previewFromAccount,
      previewFromSession,
    );
    const lastSeenAt = resolveLatestTimestamp(
      account.lastUsageRecordedAtPrimary,
      account.lastUsageRecordedAtSecondary,
      account.codexSessionTaskPreviews?.[0]?.taskUpdatedAt ?? null,
    );
    const totalTokens = Math.max(0, Math.round(account.requestUsage?.totalTokens ?? 0));
    const outputTokensRaw = Math.max(0, Math.round(account.requestUsage?.outputTokens ?? 0));
    const outputTokens = Math.min(totalTokens, outputTokensRaw);
    const inputTokens = Math.max(0, totalTokens - outputTokens);
    const cacheReadTokens = Math.max(0, Math.round(account.requestUsage?.cachedInputTokens ?? 0));
    const cacheWriteTokens = Math.max(0, Math.round(account.requestUsage?.cacheWriteTokens ?? 0));
    const timestamps = [
      ...(stickyByAccount?.timestamps ?? []),
      ...(
        account.codexSessionTaskPreviews
          ?.map((preview) => preview.taskUpdatedAt)
          .filter((value): value is string => Boolean(value)) ?? []
      ),
      ...(account.lastUsageRecordedAtPrimary ? [account.lastUsageRecordedAtPrimary] : []),
      ...(account.lastUsageRecordedAtSecondary ? [account.lastUsageRecordedAtSecondary] : []),
    ];

    accountRows.push({
      runtimeId: `account:${account.accountId}`,
      accountId: account.accountId,
      name: `${getRuntimeDisplayName(provider)} (${snapshotName})`,
      provider,
      owner: account.displayName || account.email,
      snapshotName,
      status,
      mode: "local",
      sessionCount,
      trackedSessionCount,
      lastSeenAt,
      currentTask,
      currentTasks,
      totalTokens,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheWriteTokens,
      activityTimestamps: timestamps,
      metadata: {
        cli_version: "auto-detected",
        version: "codex-cli",
        provider,
        snapshot_name: snapshotName,
        runtime_mode: "local",
      },
      isUnmapped: false,
    });
  }

  const unmappedRows: RuntimeRow[] = (sticky?.unmappedCliSessions ?? [])
    .filter((entry) => entry.totalSessionCount > 0)
    .map((entry) => {
      const provider = resolveRuntimeProvider(entry.snapshotName, entry.reason);
      return {
      runtimeId: `unmapped:${entry.snapshotName}`,
      accountId: null,
      name: `${getRuntimeDisplayName(provider)} (${entry.snapshotName})`,
      provider,
      owner: "Unmapped snapshot",
      snapshotName: entry.snapshotName,
      status: entry.totalSessionCount > 0 ? "online" : "offline",
      mode: "local",
      sessionCount: entry.totalSessionCount,
      trackedSessionCount: entry.totalSessionCount,
      lastSeenAt: null,
      currentTask: entry.reason,
      currentTasks: entry.reason ? [entry.reason] : [],
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      activityTimestamps: [],
      metadata: {
        cli_version: "auto-detected",
        version: "codex-cli",
        provider,
        snapshot_name: entry.snapshotName,
        runtime_mode: "local",
        unmapped_reason: entry.reason,
      },
      isUnmapped: true,
      };
    });

  return [...accountRows, ...unmappedRows].sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "online" ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
  });
}

function toSafeRequestLogs(requestLogs: RequestLog[] | null | undefined): RequestLog[] {
  return Array.isArray(requestLogs) ? requestLogs : [];
}

function resolveLogTokenBreakdown(log: RequestLog) {
  const explicitInput = Math.max(0, Math.round(log.inputTokens ?? 0));
  const explicitOutput = Math.max(0, Math.round(log.outputTokens ?? 0));
  const cacheRead = Math.max(0, Math.round(log.cachedInputTokens ?? 0));
  const legacyTotal = Math.max(0, Math.round(log.tokens ?? 0));

  if (explicitInput > 0 || explicitOutput > 0 || cacheRead > 0) {
    return {
      input: explicitInput,
      output: explicitOutput,
      cacheRead,
    };
  }

  return {
    input: legacyTotal,
    output: 0,
    cacheRead,
  };
}

function buildHourlyDistribution(runtime: RuntimeRow, requestLogs: RequestLog[] | null | undefined) {
  const safeRequestLogs = toSafeRequestLogs(requestLogs);
  const buckets = Array.from({ length: 24 }, () => ({
    requestCount: 0,
    totalTokens: 0,
    hasTokenData: false,
  }));
  const logTimestamps =
    safeRequestLogs.length > 0
      ? safeRequestLogs.map((log) => log.requestedAt)
      : runtime.activityTimestamps;

  if (safeRequestLogs.length > 0) {
    for (const log of safeRequestLogs) {
      const parsed = Date.parse(log.requestedAt);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      const hour = new Date(parsed).getHours();
      const breakdown = resolveLogTokenBreakdown(log);
      const totalTokens = breakdown.input + breakdown.output + breakdown.cacheRead;
      buckets[hour].requestCount += 1;
      buckets[hour].totalTokens += totalTokens;
      buckets[hour].hasTokenData = true;
    }
  } else {
    for (const timestamp of logTimestamps) {
      const parsed = Date.parse(timestamp);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      const hour = new Date(parsed).getHours();
      buckets[hour].requestCount += 1;
    }
  }

  if (logTimestamps.length === 0 && runtime.sessionCount > 0) {
    buckets[new Date().getHours()].requestCount = runtime.sessionCount;
  }

  return buckets.map((entry, hour) => ({
    hour,
    label: `${String(hour).padStart(2, "0")}:00`,
    requestCount: entry.requestCount,
    totalTokens: entry.totalTokens,
    hasTokenData: entry.hasTokenData,
  })) satisfies HourlyDistributionEntry[];
}

function getHourlyMagnitude(entry: HourlyDistributionEntry): number {
  return entry.totalTokens > 0 ? entry.totalTokens : entry.requestCount;
}

function HourlyUsageTooltip({ entry }: { entry: HourlyDistributionEntry }) {
  return (
    <div className="min-w-[170px] rounded-lg border border-emerald-300/20 bg-[#080d14]/95 px-3 py-2.5 text-xs text-slate-200 shadow-2xl shadow-black/60">
      <p className="mb-2 text-sm font-semibold text-emerald-200">{entry.label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Requests</span>
          <span className="font-semibold text-slate-100">{entry.requestCount}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Tokens spent</span>
          <span className="font-semibold text-slate-100">{formatCompactNumber(entry.totalTokens)}</span>
        </div>
        {!entry.hasTokenData ? (
          <p className="pt-1 text-[10px] text-slate-500">Estimated from runtime activity timestamps.</p>
        ) : null}
      </div>
    </div>
  );
}

function resolveBarHeightPx(magnitude: number, maxMagnitude: number): number {
  if (magnitude <= 0 || maxMagnitude <= 0) {
    return 0;
  }
  return Math.max(10, Math.round((magnitude / maxMagnitude) * 100));
}

function resolveBarOpacity(magnitude: number, maxMagnitude: number): number {
  if (magnitude <= 0 || maxMagnitude <= 0) {
    return 0.2;
  }
  const ratio = Math.min(1, magnitude / maxMagnitude);
  return 0.42 + ratio * 0.58;
}

function resolvePeakHourlyEntry(entries: HourlyDistributionEntry[]) {
  if (entries.length === 0) {
    return null;
  }
  let peak = entries[0];
  let peakMagnitude = getHourlyMagnitude(peak);
  for (const entry of entries) {
    const magnitude = getHourlyMagnitude(entry);
    if (magnitude > peakMagnitude) {
      peak = entry;
      peakMagnitude = magnitude;
    }
  }
  if (peakMagnitude <= 0) {
    return null;
  }
  return peak;
}

function formatHourlyPeak(peak: HourlyDistributionEntry | null): string {
  if (!peak) {
    return "No peak yet";
  }
  return `${peak.label} · ${formatCompactNumber(peak.totalTokens)} tokens`;
}

function formatHourlyTotalTokens(entries: HourlyDistributionEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.totalTokens, 0);
}

function formatHourlyTotalRequests(entries: HourlyDistributionEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.requestCount, 0);
}

function buildHourlyTicks(entries: HourlyDistributionEntry[]): string[] {
  const base = ["00:00", "03:00", "06:00", "09:00", "12:00", "15:00", "18:00", "21:00"];
  if (entries.length !== 24) {
    return base;
  }
  return base;
}

function getHourlyMaxMagnitude(entries: HourlyDistributionEntry[]): number {
  if (entries.length === 0) {
    return 1;
  }
  return Math.max(...entries.map((entry) => getHourlyMagnitude(entry)), 1);
}

function HourlyDistributionChart({ entries }: { entries: HourlyDistributionEntry[] }) {
  const maxMagnitude = getHourlyMaxMagnitude(entries);
  const peak = resolvePeakHourlyEntry(entries);
  const totalTokens = formatHourlyTotalTokens(entries);
  const totalRequests = formatHourlyTotalRequests(entries);
  const tickLabels = buildHourlyTicks(entries);

  return (
    <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-semibold text-slate-300">Hourly distribution</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <span className="rounded-full border border-emerald-300/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
            {formatCompactNumber(totalTokens)} tokens
          </span>
          <span className="rounded-full border border-white/[0.12] bg-white/[0.04] px-2 py-0.5 text-slate-300">
            {totalRequests} requests
          </span>
          <span className="rounded-full border border-white/[0.12] bg-white/[0.03] px-2 py-0.5 text-slate-400">
            Peak {formatHourlyPeak(peak)}
          </span>
        </div>
      </div>

      <div className="relative h-36 overflow-hidden rounded-md border border-white/[0.06] bg-[#050a11]/70 px-2">
        <div className="absolute inset-0 grid grid-rows-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="border-b border-emerald-500/10" />
          ))}
        </div>
        <div className="absolute inset-x-2 bottom-4 top-2 flex items-end gap-1">
          {entries.map((entry) => {
            const magnitude = getHourlyMagnitude(entry);
            const heightPx = resolveBarHeightPx(magnitude, maxMagnitude);
            const opacity = resolveBarOpacity(magnitude, maxMagnitude);

            return (
              <div key={entry.hour} className="flex min-w-0 flex-1 items-end justify-center">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div
                      role="img"
                      aria-label={`${entry.label}: ${entry.requestCount} requests, ${entry.totalTokens} tokens`}
                      className="group flex h-full w-full cursor-default items-end justify-center"
                    >
                      <div
                        className={cn(
                          "w-full rounded-t-md border border-transparent transition-all duration-150",
                          heightPx > 0
                            ? "bg-gradient-to-t from-emerald-600 via-emerald-500 to-emerald-300 shadow-[0_0_14px_rgba(16,185,129,0.28)] group-hover:border-emerald-200/40 group-hover:shadow-[0_0_18px_rgba(16,185,129,0.5)]"
                            : "bg-white/[0.05]",
                        )}
                        style={{
                          height: heightPx,
                          opacity,
                        }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={10} className="border border-emerald-300/20 bg-[#080d14] p-0 text-slate-100">
                    <HourlyUsageTooltip entry={entry} />
                  </TooltipContent>
                </Tooltip>
              </div>
            );
          })}
        </div>
        <div className="absolute inset-x-2 bottom-0 flex items-center justify-between text-[10px] text-slate-500">
          {tickLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function buildDailyTokenSeries(
  runtime: RuntimeRow,
  requestLogs: RequestLog[] | null | undefined,
  window: UsageWindow,
) : DailyTokenPoint[] {
  const safeRequestLogs = toSafeRequestLogs(requestLogs);
  const windowDays = resolveWindowDays(window);
  const nowMs = Date.now();
  const firstDayStartMs = startOfDayMs(nowMs - (windowDays - 1) * DAY_MS);
  const dayStarts = Array.from({ length: windowDays }, (_, index) => firstDayStartMs + index * DAY_MS);
  const dayKeyIndexMap = new Map(dayStarts.map((dayStart, index) => [dayStart, index]));

  if (safeRequestLogs.length > 0) {
    const inputValues = new Array<number>(windowDays).fill(0);
    const outputValues = new Array<number>(windowDays).fill(0);
    const cacheReadValues = new Array<number>(windowDays).fill(0);
    const cacheWriteValues = new Array<number>(windowDays).fill(0);
    for (const log of safeRequestLogs) {
      const parsed = Date.parse(log.requestedAt);
      if (!Number.isFinite(parsed)) {
        continue;
      }
      if (parsed < firstDayStartMs || parsed > nowMs + DAY_MS) {
        continue;
      }
      const dayStart = startOfDayMs(parsed);
      const index = dayKeyIndexMap.get(dayStart);
      if (index == null) {
        continue;
      }
      const breakdown = resolveLogTokenBreakdown(log);
      inputValues[index] += breakdown.input;
      outputValues[index] += breakdown.output;
      cacheReadValues[index] += breakdown.cacheRead;
    }
    const runtimeCacheWrite = Math.max(0, Math.round(runtime.cacheWriteTokens));
    if (runtimeCacheWrite > 0) {
      const distributionWeights = inputValues.map((input, index) => {
        const output = outputValues[index] ?? 0;
        const cacheRead = cacheReadValues[index] ?? 0;
        const total = input + output + cacheRead;
        return total > 0 ? total : 0;
      });
      const distributedCacheWrite = distributeTotalAcrossDays(runtimeCacheWrite, distributionWeights);
      for (let index = 0; index < cacheWriteValues.length; index += 1) {
        cacheWriteValues[index] = distributedCacheWrite[index] ?? 0;
      }
    }

    if (
      inputValues.some((value) => value > 0) ||
      outputValues.some((value) => value > 0) ||
      cacheReadValues.some((value) => value > 0) ||
      cacheWriteValues.some((value) => value > 0)
    ) {
      return inputValues.map((input, index) => {
        const output = outputValues[index] ?? 0;
        const cacheRead = cacheReadValues[index] ?? 0;
        const cacheWrite = cacheWriteValues[index] ?? 0;
        const total = input + output + cacheRead + cacheWrite;
        return {
        key: `${dayStarts[index]}`,
          label: formatMonthDayLabel(new Date(dayStarts[index]).toISOString()),
          input,
          output,
          cacheRead,
          cacheWrite,
          total,
        };
      });
    }
  }

  const scaledInput = Math.max(0, Math.round(runtime.inputTokens));
  const scaledOutput = Math.max(0, Math.round(runtime.outputTokens));
  const scaledCacheRead = Math.max(0, Math.round(runtime.cacheReadTokens));
  const scaledCacheWrite = Math.max(0, Math.round(runtime.cacheWriteTokens));
  const scaledTotal = scaledInput + scaledOutput + scaledCacheRead + scaledCacheWrite;

  if (scaledTotal <= 0) {
    return dayStarts.map((dayStart) => ({
      key: `${dayStart}`,
      label: formatMonthDayLabel(new Date(dayStart).toISOString()),
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    }));
  }

  const activityCounts = new Array<number>(windowDays).fill(0);
  for (const timestamp of runtime.activityTimestamps) {
    const parsed = Date.parse(timestamp);
    if (!Number.isFinite(parsed) || parsed < firstDayStartMs || parsed > nowMs + DAY_MS) {
      continue;
    }
    const dayStart = startOfDayMs(parsed);
    const index = dayKeyIndexMap.get(dayStart);
    if (index == null) {
      continue;
    }
    activityCounts[index] += 1;
  }
  const weights = resolveFallbackDailyUsageWeights(
    activityCounts,
    runtime.sessionCount,
  );
  const inputByDay = distributeTotalAcrossDays(scaledInput, weights);
  const outputByDay = distributeTotalAcrossDays(scaledOutput, weights);
  const cacheReadByDay = distributeTotalAcrossDays(scaledCacheRead, weights);
  const cacheWriteByDay = distributeTotalAcrossDays(scaledCacheWrite, weights);

  return dayStarts.map((dayStart, index) => {
    const input = inputByDay[index] ?? 0;
    const output = outputByDay[index] ?? 0;
    const cacheRead = cacheReadByDay[index] ?? 0;
    const cacheWrite = cacheWriteByDay[index] ?? 0;
    const total = input + output + cacheRead + cacheWrite;
    return {
      key: `${dayStart}`,
      label: formatMonthDayLabel(new Date(dayStart).toISOString()),
      input,
      output,
      cacheRead,
      cacheWrite,
      total,
    };
  });
}

function buildTokenStats(runtime: RuntimeRow, _window: UsageWindow, requestLogs: RequestLog[] | null | undefined) {
  const safeRequestLogs = toSafeRequestLogs(requestLogs);
  if (safeRequestLogs.length > 0) {
    let input = 0;
    let output = 0;
    let cacheRead = 0;
    for (const log of safeRequestLogs) {
      const breakdown = resolveLogTokenBreakdown(log);
      input += breakdown.input;
      output += breakdown.output;
      cacheRead += breakdown.cacheRead;
    }
    return {
      input,
      output,
      cacheRead,
      cacheWrite: Math.max(0, Math.round(runtime.cacheWriteTokens)),
    };
  }

  const input = Math.max(0, Math.round(runtime.inputTokens));
  const output = Math.max(0, Math.round(runtime.outputTokens));
  const cacheRead = Math.max(0, Math.round(runtime.cacheReadTokens));
  const cacheWrite = Math.max(0, Math.round(runtime.cacheWriteTokens));
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
  };
}

function buildActivityHeatmapRows(
  runtime: RuntimeRow,
  requestLogs: RequestLog[] | null | undefined,
  days = 7,
): ActivityHeatmapRow[] {
  const safeRequestLogs = toSafeRequestLogs(requestLogs);
  const nowMs = Date.now();
  const firstDayStartMs = startOfDayMs(nowMs - (days - 1) * DAY_MS);
  const dayStarts = Array.from({ length: days }, (_, index) => firstDayStartMs + index * DAY_MS);
  const dayKeyIndexMap = new Map(dayStarts.map((dayStart, index) => [dayStart, index]));
  const buckets = Array.from({ length: days }, () => new Array<number>(24).fill(0));

  if (safeRequestLogs.length > 0) {
    for (const log of safeRequestLogs) {
      const parsed = Date.parse(log.requestedAt);
      if (!Number.isFinite(parsed) || parsed < firstDayStartMs || parsed > nowMs + DAY_MS) {
        continue;
      }
      const dayStart = startOfDayMs(parsed);
      const dayIndex = dayKeyIndexMap.get(dayStart);
      if (dayIndex == null) {
        continue;
      }
      const hour = new Date(parsed).getHours();
      buckets[dayIndex][hour] += 1;
    }
  } else {
    for (const timestamp of runtime.activityTimestamps) {
      const parsed = Date.parse(timestamp);
      if (!Number.isFinite(parsed) || parsed < firstDayStartMs || parsed > nowMs + DAY_MS) {
        continue;
      }
      const dayStart = startOfDayMs(parsed);
      const dayIndex = dayKeyIndexMap.get(dayStart);
      if (dayIndex == null) {
        continue;
      }
      const hour = new Date(parsed).getHours();
      buckets[dayIndex][hour] += 1;
    }
  }

  const flat = buckets.flat();
  let max = Math.max(...flat, 0);
  if (max === 0 && runtime.sessionCount > 0) {
    const dayIndex = days - 1;
    const hour = new Date().getHours();
    buckets[dayIndex][hour] = Math.max(1, runtime.sessionCount);
    max = Math.max(1, runtime.sessionCount);
  }

  const resolveLevel = (value: number): number => {
    if (value <= 0) return 0;
    const ratio = value / Math.max(max, 1);
    if (ratio >= 0.75) return 4;
    if (ratio >= 0.5) return 3;
    if (ratio >= 0.25) return 2;
    return 1;
  };

  return dayStarts.map((dayStart, index) => ({
    key: `${dayStart}`,
    label: new Intl.DateTimeFormat("en-US", { weekday: "short" }).format(new Date(dayStart)),
    levels: buckets[index].map(resolveLevel),
  }));
}

function computeDailyUsageTicks(points: DailyTokenPoint[], tickCount = 5) {
  const maxValue = points.reduce((max, point) => Math.max(max, point.total), 0);
  if (maxValue <= 0) {
    return [0];
  }

  const rawStep = maxValue / Math.max(tickCount - 1, 1);
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const steps = [1, 2, 2.5, 5, 10];
  const niceStep = magnitude * (steps.find((step) => step * magnitude >= rawStep) ?? 10);
  const ticks: number[] = [];

  for (let index = 0; index < tickCount; index += 1) {
    ticks.push(index * niceStep);
  }
  if ((ticks[ticks.length - 1] ?? 0) < maxValue) {
    ticks.push(tickCount * niceStep);
  }
  return ticks;
}

function DailyUsageTooltip({ active, payload, label }: DailyUsageTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) {
    return null;
  }
  return (
    <div className="min-w-[190px] rounded-xl border border-white/[0.1] bg-[#080b12]/95 px-4 py-3 text-xs shadow-2xl shadow-black/60">
      <p className="mb-2 text-lg font-semibold leading-none text-slate-100">{label}</p>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Input</span>
          <span className="font-semibold text-slate-100">{formatTokenMillions(row.input)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Output</span>
          <span className="font-semibold text-slate-100">{formatTokenMillions(row.output)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Cache Read</span>
          <span className="font-semibold text-slate-100">{formatTokenMillions(row.cacheRead)}</span>
        </div>
        <div className="flex items-center justify-between gap-5">
          <span className="text-slate-400">Cache Write</span>
          <span className="font-semibold text-slate-100">{formatTokenMillions(row.cacheWrite)}</span>
        </div>
        <div className="mt-1 border-t border-white/[0.08] pt-2">
          <div className="flex items-center justify-between gap-5">
            <span className="text-slate-200">Total</span>
            <span className="font-semibold text-slate-100">{formatTokenMillions(row.total)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveRuntimeTimestamps(runtime: RuntimeRow, requestLogs: RequestLog[] | null | undefined) {
  const safeRequestLogs = toSafeRequestLogs(requestLogs);
  const parsed = [
    ...runtime.activityTimestamps.map((value) => Date.parse(value)),
    ...safeRequestLogs.map((log) => Date.parse(log.requestedAt)),
    ...(runtime.lastSeenAt ? [Date.parse(runtime.lastSeenAt)] : []),
  ].filter((value) => Number.isFinite(value));

  if (parsed.length === 0) {
    return {
      created: "—",
      updated: "—",
    };
  }

  const createdMs = Math.min(...parsed);
  const updatedMs = Math.max(...parsed);

  return {
    created: new Date(createdMs).toLocaleString(),
    updated: new Date(updatedMs).toLocaleString(),
  };
}

function HeatCell({ level }: { level: number }) {
  return (
    <div
      className={cn(
        "h-3 w-3 rounded-[3px] border border-white/[0.08]",
        level === 0 && "bg-white/[0.02]",
        level === 1 && "bg-emerald-500/28",
        level === 2 && "bg-emerald-500/44",
        level === 3 && "bg-emerald-400/70 shadow-[0_0_10px_rgba(16,185,129,0.25)]",
        level === 4 && "bg-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.35)]",
      )}
    />
  );
}

function CodexProviderLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M14.949 6.547a3.94 3.94 0 0 0-.348-3.273 4.11 4.11 0 0 0-4.4-1.934A4.1 4.1 0 0 0 8.423.2 4.15 4.15 0 0 0 6.305.086a4.1 4.1 0 0 0-1.891.948 4.04 4.04 0 0 0-1.158 1.753 4.1 4.1 0 0 0-1.563.679A4 4 0 0 0 .554 4.72a3.99 3.99 0 0 0 .502 4.731 3.94 3.94 0 0 0 .346 3.274 4.11 4.11 0 0 0 4.402 1.933c.382.425.852.764 1.377.995.526.231 1.095.35 1.67.346 1.78.002 3.358-1.132 3.901-2.804a4.1 4.1 0 0 0 1.563-.68 4 4 0 0 0 1.14-1.253 3.99 3.99 0 0 0-.506-4.716m-6.097 8.406a3.05 3.05 0 0 1-1.945-.694l.096-.054 3.23-1.838a.53.53 0 0 0 .265-.455v-4.49l1.366.778q.02.011.025.035v3.722c-.003 1.653-1.361 2.992-3.037 2.996m-6.53-2.75a2.95 2.95 0 0 1-.36-2.01l.095.057L5.29 12.09a.53.53 0 0 0 .527 0l3.949-2.246v1.555a.05.05 0 0 1-.022.041L6.473 13.3c-1.454.826-3.311.335-4.15-1.098m-.85-6.94A3.02 3.02 0 0 1 3.07 3.949v3.785a.51.51 0 0 0 .262.451l3.93 2.237-1.366.779a.05.05 0 0 1-.048 0L2.585 9.342a2.98 2.98 0 0 1-1.113-4.094zm11.216 2.571L8.747 5.576l1.362-.776a.05.05 0 0 1 .048 0l3.265 1.86a3 3 0 0 1 1.173 1.207 2.96 2.96 0 0 1-.27 3.2 3.05 3.05 0 0 1-1.36.997V8.279a.52.52 0 0 0-.276-.445m1.36-2.015-.097-.057-3.226-1.855a.53.53 0 0 0-.53 0L6.249 6.153V4.598a.04.04 0 0 1 .019-.04L9.533 2.7a3.07 3.07 0 0 1 3.257.139c.474.325.843.778 1.066 1.303.223.526.289 1.103.191 1.664zM5.503 8.575 4.139 7.8a.05.05 0 0 1-.026-.037V4.049c0-.57.166-1.127.476-1.607s.752-.864 1.275-1.105a3.08 3.08 0 0 1 3.234.41l-.096.054-3.23 1.838a.53.53 0 0 0-.265.455zm.742-1.577 1.758-1 1.762 1v2l-1.755 1-1.762-1z" />
    </svg>
  );
}

function OpenclawProviderLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M8 2C5.5 2 3.5 4 3.5 6.5S5 10.5 6.5 11v1.5H8V11c.3.1.7.1 1 0v1.5h1.5V11c1.5-.5 3-2.5 3-4.5S10.5 2 8 2Z"
        fill="#E8453A"
      />
      <path d="M3.5 5.5C2 5 1 6 1.5 7s2 .5 2.2-.7" fill="#FF6B5A" />
      <path d="M12.5 5.5c1.5-.5 2.5.5 2 1.5s-2 .5-2.2-.7" fill="#FF6B5A" />
      <path d="M6.5 3Q5 1.2 4.3 1.5" stroke="#FF6B5A" strokeWidth="0.8" strokeLinecap="round" />
      <path d="M9.5 3Q11 1.2 11.7 1.5" stroke="#FF6B5A" strokeWidth="0.8" strokeLinecap="round" />
      <circle cx="6.2" cy="5.2" r="0.9" fill="#050810" />
      <circle cx="9.8" cy="5.2" r="0.9" fill="#050810" />
      <circle cx="6.4" cy="5" r="0.3" fill="#00E5CC" />
      <circle cx="10" cy="5" r="0.3" fill="#00E5CC" />
    </svg>
  );
}

function RuntimeProviderGlyph({ provider }: { provider: RuntimeRow["provider"] }) {
  if (provider === "openclaw") {
    return <OpenclawProviderLogo className="h-4 w-4 shrink-0" />;
  }

  return <CodexProviderLogo className="h-4 w-4 shrink-0 text-slate-100" />;
}

function RuntimeListItem({
  runtime,
  selected,
  onClick,
}: {
  runtime: RuntimeRow;
  selected: boolean;
  onClick: () => void;
}) {
  const olderSessionPreviewCount = Math.max(
    0,
    runtime.currentTasks.length - runtime.sessionCount,
  );

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group/runtime w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-white/[0.18] bg-white/[0.08]"
          : "border-transparent bg-transparent hover:border-white/[0.08]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <RuntimeProviderGlyph provider={runtime.provider} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">{runtime.name}</p>
            <p className="truncate text-xs text-slate-400">{runtime.owner}</p>
          </div>
        </div>
        <span className="inline-flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-sky-400/90 hover:bg-sky-400/10"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent
              side="top"
              align="end"
              sideOffset={10}
              className="w-72 rounded-xl border border-white/[0.12] bg-[#101318] px-3 py-2.5 text-slate-100 shadow-xl"
            >
              <p className="mb-1 text-[11px] uppercase tracking-[0.1em] text-slate-400">
                {runtime.currentTasks.length > 1
                  ? "Session tasks"
                  : "Session task"}
              </p>
              {runtime.currentTasks.length > 0 ? (
                <ul className="space-y-1 text-xs text-slate-200">
                  {runtime.currentTasks.map((taskPreview, index) => (
                    <li
                      key={`${runtime.runtimeId}-task-${index}`}
                      className="flex items-start gap-1.5"
                    >
                      {runtime.currentTasks.length > 1 ? (
                        <span className="mt-0.5 inline-flex min-w-5 justify-end font-mono text-[10px] text-slate-400">
                          {index + 1}.
                        </span>
                      ) : null}
                      <span className="break-words">{taskPreview}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-200">
                  No active task preview.
                </p>
              )}
              {olderSessionPreviewCount > 0 ? (
                <p className="mt-2 text-[10px] text-slate-400">
                  Includes {olderSessionPreviewCount} older session
                  {olderSessionPreviewCount === 1 ? " preview." : " previews."}
                </p>
              ) : null}
            </TooltipContent>
          </Tooltip>
          <span
            className={cn(
              "h-2.5 w-2.5 rounded-full",
              runtime.status === "online" ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.4)]" : "bg-slate-500",
            )}
          />
        </span>
      </div>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
        <Badge variant="secondary" className="h-5 border-white/10 bg-white/[0.04] px-1.5 py-0 text-[10px] text-slate-300">
          {runtime.sessionCount} live
        </Badge>
        {olderSessionPreviewCount > 0 ? (
          <Badge
            variant="secondary"
            className="h-5 border-emerald-400/25 bg-emerald-500/10 px-1.5 py-0 text-[10px] text-emerald-200"
          >
            +{olderSessionPreviewCount} older
          </Badge>
        ) : null}
        <span>{runtime.snapshotName}</span>
      </div>
    </button>
  );
}

type ConnectionState = {
  status: "idle" | "testing" | "connected" | "failed";
  latencyMs: number | null;
  message: string | null;
};

export function RuntimesPage() {
  const [scope, setScope] = useState<RuntimeScope>("mine");
  const [selectedRuntimeId, setSelectedRuntimeId] = useState<string>("");
  const [usageWindow, setUsageWindow] = useState<UsageWindow>("30d");
  const [runtimeMode, setRuntimeMode] = useState<"local" | "cloud">("local");
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "idle",
    latencyMs: null,
    message: null,
  });

  const dashboardQuery = useDashboard();
  const stickyQuery = useQuery({
    queryKey: ["sticky-sessions", "runtime-list"],
    queryFn: () =>
      listStickySessions({
        kind: "codex_session",
        staleOnly: false,
        activeOnly: false,
        offset: 0,
        limit: 500,
      }),
    refetchInterval: 10_000,
    refetchIntervalInBackground: true,
  });

  const runtimeRows = useMemo(
    () => buildRuntimeRows(dashboardQuery.data?.accounts, stickyQuery.data),
    [dashboardQuery.data?.accounts, stickyQuery.data],
  );
  const scopedRows = useMemo(() => {
    if (scope === "mine") {
      return runtimeRows.filter((runtime) => runtime.status === "online");
    }
    return runtimeRows;
  }, [runtimeRows, scope]);
  const effectiveSelectedRuntimeId =
    selectedRuntimeId && scopedRows.some((runtime) => runtime.runtimeId === selectedRuntimeId)
      ? selectedRuntimeId
      : scopedRows[0]?.runtimeId ?? "";
  const selectedRuntime = scopedRows.find((runtime) => runtime.runtimeId === effectiveSelectedRuntimeId) ?? null;
  const selectedRuntimeOlderTaskCount = selectedRuntime
    ? Math.max(0, selectedRuntime.currentTasks.length - selectedRuntime.sessionCount)
    : 0;

  const usageWindowDays = resolveWindowDays(usageWindow);
  const selectedAccountRequestLogsQuery = useQuery({
    queryKey: ["request-logs", "runtime-usage", selectedRuntime?.accountId, usageWindowDays],
    queryFn: () =>
      getRequestLogs({
        accountIds: selectedRuntime?.accountId ? [selectedRuntime.accountId] : [],
        since: new Date(Date.now() - usageWindowDays * DAY_MS).toISOString(),
        limit: 2_000,
      }),
    enabled: Boolean(selectedRuntime?.accountId),
    refetchInterval: 30_000,
    refetchIntervalInBackground: true,
  });
  const selectedAccountRequestLogs = useMemo(
    () => selectedAccountRequestLogsQuery.data?.requests ?? [],
    [selectedAccountRequestLogsQuery.data?.requests],
  );
  const runtimeTimestamps = useMemo(
    () => (selectedRuntime ? resolveRuntimeTimestamps(selectedRuntime, selectedAccountRequestLogs) : null),
    [selectedRuntime, selectedAccountRequestLogs],
  );
  const metadataText = useMemo(
    () => (selectedRuntime ? JSON.stringify(selectedRuntime.metadata, null, 2) : "{}"),
    [selectedRuntime],
  );

  const dailySeries = useMemo(
    () =>
      selectedRuntime
        ? buildDailyTokenSeries(
            selectedRuntime,
            selectedAccountRequestLogs,
            usageWindow,
          )
        : [],
    [selectedRuntime, selectedAccountRequestLogs, usageWindow],
  );
  const dailyTicks = useMemo(() => computeDailyUsageTicks(dailySeries), [dailySeries]);
  const dailyMaxTick = dailyTicks[dailyTicks.length - 1] ?? 0;
  const dailyAxisTickFormatter = (value: number) => {
    const safe = Math.max(0, Math.round(Number(value) || 0));
    if (safe === 0) return "0";
    if (dailyMaxTick >= 1_000_000) {
      return `${Math.round(safe / 1_000_000)}M`;
    }
    if (dailyMaxTick >= 1_000) {
      return `${Math.round(safe / 1_000)}K`;
    }
    return `${safe}`;
  };
  const activityHeatmapRows = useMemo(
    () => (selectedRuntime ? buildActivityHeatmapRows(selectedRuntime, selectedAccountRequestLogs, 7) : []),
    [selectedRuntime, selectedAccountRequestLogs],
  );
  const hourlyDistribution = selectedRuntime
    ? buildHourlyDistribution(selectedRuntime, selectedAccountRequestLogs)
    : [];
  const tokenStats = selectedRuntime
    ? buildTokenStats(selectedRuntime, usageWindow, selectedAccountRequestLogs)
    : null;
  const onlineCount = runtimeRows.filter((runtime) => runtime.status === "online").length;
  const panelSurfaceClass =
    "overflow-hidden border-white/[0.08] bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)] py-0 text-slate-100";

  const testConnection = async () => {
    setConnectionState({
      status: "testing",
      latencyMs: null,
      message: null,
    });
    const probes = [
      { path: "/health", label: "health" },
      { path: "/api/dashboard/overview", label: "dashboard" },
      { path: "/api/request-logs/options", label: "request logs" },
    ] as const;

    let lastError = "Connection test failed.";
    for (const probe of probes) {
      const start = performance.now();
      try {
        const response = await fetch(probe.path, {
          cache: "no-store",
          headers: { "cache-control": "no-cache" },
        });
        const latency = Math.max(0, Math.round(performance.now() - start));
        if (!response.ok) {
          lastError = `${probe.label} endpoint returned ${response.status}.`;
          continue;
        }
        setConnectionState({
          status: "connected",
          latencyMs: latency,
          message: `Connected via ${probe.label}`,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error.message : `${probe.label} probe failed.`;
      }
    }

    setConnectionState({
      status: "failed",
      latencyMs: null,
      message: lastError,
    });
  };

  if ((dashboardQuery.isLoading || stickyQuery.isLoading) && runtimeRows.length === 0) {
    return (
      <div className="py-10">
        <SpinnerBlock />
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up h-full w-full overflow-hidden bg-[linear-gradient(180deg,rgba(7,10,18,0.97)_0%,rgba(3,5,12,1)_100%)]">
      <div className="grid h-[calc(100vh-98px)] gap-px bg-white/[0.06] xl:grid-cols-[340px_minmax(0,1fr)]">
        <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0 xl:border-r xl:border-white/[0.08]")}>
          <CardContent className="flex h-full flex-col space-y-3 p-3">
            <div className="flex items-center justify-between px-1 text-xs text-slate-400">
              <span>
                {onlineCount}/{runtimeRows.length} online
              </span>
            </div>

            <Tabs value={scope} onValueChange={(value) => setScope((value as RuntimeScope) ?? "mine")}>
              <TabsList className="h-8 w-full rounded-lg bg-white/[0.06] p-1">
                <TabsTrigger className="text-xs" value="mine">
                  Mine
                </TabsTrigger>
                <TabsTrigger className="text-xs" value="all">
                  All
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="flex-1 space-y-2 overflow-y-auto pr-1">
              {scopedRows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.02] px-3 py-4 text-xs text-slate-400">
                  No active codex-auth sessions found.
                </p>
              ) : (
                scopedRows.map((runtime) => (
                  <RuntimeListItem
                    key={runtime.runtimeId}
                    runtime={runtime}
                    selected={runtime.runtimeId === effectiveSelectedRuntimeId}
                    onClick={() => setSelectedRuntimeId(runtime.runtimeId)}
                  />
                ))
              )}
            </div>
          </CardContent>
        </Card>

        {selectedRuntime ? (
          <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0")}>
            <CardContent className="h-full space-y-5 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 md:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Runtime</p>
                  <div className="mt-1 flex min-w-0 items-center gap-2">
                    <RuntimeProviderGlyph provider={selectedRuntime.provider} />
                    <p className="truncate text-sm font-medium text-slate-100">{selectedRuntime.name}</p>
                  </div>
                  <p className="text-[11px] text-slate-500">{selectedRuntime.snapshotName}</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Runtime mode</p>
                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setRuntimeMode("local")}
                      className={cn(
                        "h-6 rounded-md border px-2 text-[10px] font-medium transition-colors",
                        runtimeMode === "local"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                          : "border-white/[0.12] bg-white/[0.02] text-slate-300 hover:bg-white/[0.06]",
                      )}
                    >
                      Local
                    </button>
                    <button
                      type="button"
                      disabled
                      className="h-6 cursor-not-allowed rounded-md border border-white/[0.12] bg-white/[0.02] px-2 text-[10px] font-medium text-slate-500"
                    >
                      Cloud · coming soon
                    </button>
                  </div>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Status</p>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <Badge
                      variant="secondary"
                      className={cn(
                        "border px-2 py-0.5 text-xs font-medium",
                        selectedRuntime.status === "online"
                          ? "border-emerald-400/40 bg-emerald-500/15 text-emerald-200"
                          : "border-slate-500/40 bg-slate-500/15 text-slate-300",
                      )}
                    >
                      {selectedRuntime.status}
                    </Badge>
                    <Button
                      type="button"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      variant="outline"
                      onClick={() => {
                        void testConnection();
                      }}
                      disabled={connectionState.status === "testing"}
                    >
                      {connectionState.status === "testing" ? "Testing..." : "Test connection"}
                    </Button>
                  </div>
                  <div className="mt-2 text-[11px] text-slate-300">
                    <span className="text-slate-500">Last seen </span>
                    {selectedRuntime.lastSeenAt ? formatLastUsageLabel(selectedRuntime.lastSeenAt) : "Telemetry pending"}
                  </div>
                  {connectionState.status === "connected" ? (
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {connectionState.message}
                      {connectionState.latencyMs != null ? ` (${connectionState.latencyMs} ms)` : ""}
                    </div>
                  ) : null}
                  {connectionState.status === "failed" ? (
                    <div className="mt-1 text-[11px] text-red-300">{connectionState.message ?? "Connection failed."}</div>
                  ) : null}
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Provider</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">{getRuntimeDisplayName(selectedRuntime.provider)}</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Owner</p>
                  <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-slate-100">
                    <UserRound className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {selectedRuntime.owner}
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Live sessions</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">{selectedRuntime.sessionCount}</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Tracked sessions</p>
                  <p className="mt-1 text-sm font-medium text-slate-100">{selectedRuntime.trackedSessionCount}</p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3 md:col-span-2">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">
                    {selectedRuntime.currentTasks.length > 1
                      ? "Session tasks"
                      : "Session task"}
                  </p>
                  {selectedRuntimeOlderTaskCount > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      Includes {selectedRuntimeOlderTaskCount} older session
                      {selectedRuntimeOlderTaskCount === 1
                        ? " preview."
                        : " previews."}
                    </p>
                  ) : null}
                  {selectedRuntime.currentTasks.length > 0 ? (
                    <ul className="mt-1 space-y-1">
                      {selectedRuntime.currentTasks.map((taskPreview, index) => (
                        <li
                          key={`${selectedRuntime.runtimeId}-current-task-${index}`}
                          className="flex items-start gap-1.5 text-sm font-medium text-slate-100"
                        >
                          {selectedRuntime.currentTasks.length > 1 ? (
                            <span className="mt-0.5 inline-flex min-w-5 justify-end font-mono text-[11px] text-slate-400">
                              {index + 1}.
                            </span>
                          ) : null}
                          <span className="break-words">{taskPreview}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1 text-sm font-medium text-slate-100">
                      Waiting for new task
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-xs font-semibold text-slate-300">CLI version</p>
                  <p className="mt-1 text-sm text-slate-100">codex-cli (auto-detected)</p>
                  <p className="text-xs text-slate-500">
                    Snapshot {selectedRuntime.snapshotName} · source codex-auth session mapping
                  </p>
                </div>
                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="text-xs font-semibold text-slate-300">Runtime source</p>
                  <p className="mt-1 text-sm text-slate-100">codex-auth session mapping</p>
                  <p className="text-xs text-slate-500">Cloud mode will be enabled in a later release.</p>
                </div>
              </div>

              <section className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">Token usage</p>
                  <Tabs value={usageWindow} onValueChange={(value) => setUsageWindow((value as UsageWindow) ?? "30d")}>
                    <TabsList className="h-8 bg-white/[0.06] p-1">
                      <TabsTrigger value="7d" className="text-xs">
                        7d
                      </TabsTrigger>
                      <TabsTrigger value="30d" className="text-xs">
                        30d
                      </TabsTrigger>
                      <TabsTrigger value="90d" className="text-xs">
                        90d
                      </TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>

                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Input</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {tokenStats ? formatCompactNumber(tokenStats.input) : "--"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Output</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {tokenStats ? formatCompactNumber(tokenStats.output) : "--"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Cache read</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {tokenStats ? formatCompactNumber(tokenStats.cacheRead) : "--"}
                    </p>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Cache write</p>
                    <p className="mt-1 text-lg font-semibold text-slate-100">
                      {tokenStats ? formatCompactNumber(tokenStats.cacheWrite) : "--"}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-2">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="mb-2 text-xs font-semibold text-slate-300">Activity</p>
                    <div className="space-y-1">
                      {activityHeatmapRows.length === 0 ? (
                        <p className="py-3 text-xs text-slate-500">No activity samples yet.</p>
                      ) : (
                        activityHeatmapRows.map((row) => (
                          <div key={row.key} className="flex items-center gap-2">
                            <span className="w-7 shrink-0 text-[10px] text-slate-500">{row.label}</span>
                            <div className="grid flex-1 gap-0.5 [grid-template-columns:repeat(24,minmax(0,1fr))]">
                              {row.levels.map((level, index) => (
                                <HeatCell key={`${row.key}-${index}`} level={level} />
                              ))}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500">
                      <span>00</span>
                      <span>06</span>
                      <span>12</span>
                      <span>18</span>
                      <span>23</span>
                    </div>
                  </div>

                  <HourlyDistributionChart entries={hourlyDistribution} />
                </div>

                <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                  <p className="mb-2 text-xs font-semibold text-slate-300">Daily Token Usage</p>
                  {dailySeries.length === 0 ? (
                    <p className="py-6 text-xs text-slate-500">No daily usage samples yet.</p>
                  ) : (
                    <div className="h-48">
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={dailySeries} margin={{ top: 8, right: 8, bottom: 2, left: 2 }}>
                          <defs>
                            <linearGradient id="daily-usage-fill" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="#10b981" stopOpacity={0.32} />
                              <stop offset="100%" stopColor="#10b981" stopOpacity={0.04} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid vertical={false} stroke="rgba(148,163,184,0.13)" />
                          <XAxis
                            dataKey="label"
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgba(148,163,184,0.75)", fontSize: 11 }}
                            minTickGap={20}
                            interval="preserveStartEnd"
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tick={{ fill: "rgba(148,163,184,0.75)", fontSize: 11 }}
                            width={60}
                            tickFormatter={dailyAxisTickFormatter}
                            ticks={dailyTicks}
                          />
                          <RechartsTooltip
                            content={<DailyUsageTooltip />}
                            cursor={{ stroke: "rgba(148,163,184,0.22)", strokeWidth: 1 }}
                          />
                          <Area
                            type="monotone"
                            dataKey="total"
                            stroke="#34d399"
                            strokeWidth={1.8}
                            fill="url(#daily-usage-fill)"
                            dot={false}
                            activeDot={{ r: 4, fill: "#02060d", stroke: "#000000", strokeWidth: 1.2 }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="mb-2 text-xs font-semibold text-slate-300">Metadata</p>
                    <pre className="max-h-44 overflow-auto rounded-md border border-white/[0.08] bg-black/20 p-3 text-[11px] leading-relaxed text-emerald-100/90">
                      {metadataText}
                    </pre>
                  </div>
                  <div className="rounded-lg border border-white/[0.08] bg-white/[0.02] p-3">
                    <p className="text-xs font-semibold text-slate-300">Timestamps</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3 text-sm">
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Created</p>
                        <p className="mt-1 text-slate-100">{runtimeTimestamps?.created ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[11px] uppercase tracking-[0.12em] text-slate-500">Updated</p>
                        <p className="mt-1 text-slate-100">{runtimeTimestamps?.updated ?? "—"}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {selectedRuntime.isUnmapped ? (
                <div className="rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
                  This runtime row is an unmapped codex-auth snapshot. Map the snapshot to an account to unlock per-account trends.
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className={cn(panelSurfaceClass, "h-full rounded-none border-0 border-dashed border-white/[0.12] text-slate-300")}>
            <CardContent className="flex min-h-[420px] flex-col items-center justify-center gap-2">
              <Server className="h-8 w-8 text-slate-500" />
              <p className="text-sm font-medium">No runtime selected</p>
              <p className="text-xs text-slate-500">Open codex-auth sessions to populate this panel automatically.</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
