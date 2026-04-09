import { useEffect, useState } from "react";
import { Activity, AlertTriangle, ArrowRightLeft, Tag } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { fetchRuntimeAppVersion } from "@/components/layout/app-version";
import { getDashboardOverview } from "@/features/dashboard/api";
import { getSettings } from "@/features/settings/api";
import { formatTimeLong } from "@/utils/formatters";

const LAST_SYNC_STALE_WARNING_MS = 60_000;
const LAST_SYNC_CHECK_INTERVAL_MS = 10_000;

function isRequestTimeoutError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  const maybe = error as { code?: unknown; message?: unknown };
  if (maybe.code === "request_timeout") {
    return true;
  }
  if (typeof maybe.message === "string") {
    return maybe.message.toLowerCase().includes("timed out");
  }
  return false;
}

function getRoutingLabel(strategy: "usage_weighted" | "round_robin" | "capacity_weighted", sticky: boolean, preferEarlier: boolean): string {
  if (strategy === "round_robin") {
    return sticky ? "Round robin + Sticky threads" : "Round robin";
  }
  if (strategy === "capacity_weighted") {
    if (sticky && preferEarlier) return "Capacity weighted + Sticky + Early reset";
    if (sticky) return "Capacity weighted + Sticky threads";
    if (preferEarlier) return "Capacity weighted + Early reset";
    return "Capacity weighted";
  }
  if (sticky && preferEarlier) return "Sticky + Early reset";
  if (sticky) return "Sticky threads";
  if (preferEarlier) return "Early reset preferred";
  return "Usage weighted";
}

export function StatusBar() {
  const {
    data: lastSyncAt = null,
    error: lastSyncError,
  } = useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    select: (data) => data.lastSyncAt,
  });

  const { data: settings } = useQuery({
    queryKey: ["settings", "detail"],
    queryFn: getSettings,
  });
  const { data: runtimeVersion } = useQuery({
    queryKey: ["app", "runtime-version"],
    queryFn: () => fetchRuntimeAppVersion(),
    staleTime: 60_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
  });
  const lastSync = formatTimeLong(lastSyncAt);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const parsedLastSyncAtMs = (() => {
    if (!lastSyncAt) {
      return null;
    }
    const value = Date.parse(lastSyncAt);
    return Number.isFinite(value) ? value : null;
  })();
  const syncAgeMs = parsedLastSyncAtMs == null ? null : nowMs - parsedLastSyncAtMs;
  const isLive = syncAgeMs != null && syncAgeMs < LAST_SYNC_STALE_WARNING_MS;
  const hasStaleLastSync = syncAgeMs != null && syncAgeMs > LAST_SYNC_STALE_WARNING_MS;
  const hasRequestTimeoutError = isRequestTimeoutError(lastSyncError);
  const showRequestTimeoutWarning = hasRequestTimeoutError && !isLive;
  const showLastSyncTimeoutWarning = showRequestTimeoutWarning || hasStaleLastSync;
  const lastSyncTimeoutWarningLabel = hasRequestTimeoutError
    ? "request timeout"
    : "timeout > 1m";

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), LAST_SYNC_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const routingLabel = settings
    ? getRoutingLabel(settings.routingStrategy, settings.stickyThreadsEnabled, settings.preferEarlierResetAccounts)
    : "—";
  const displayVersion =
    typeof runtimeVersion === "string" && runtimeVersion.trim().length > 0
      ? runtimeVersion
      : process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";

  return (
    <footer className="fixed bottom-0 left-0 right-0 z-50 border-t border-white/[0.08] bg-background/50 px-4 py-2 shadow-[0_-1px_12px_rgba(0,0,0,0.06)] backdrop-blur-xl backdrop-saturate-[1.8] supports-[backdrop-filter]:bg-background/40 dark:shadow-[0_-1px_12px_rgba(0,0,0,0.25)]">
      <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-5 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {showLastSyncTimeoutWarning ? (
            <AlertTriangle className="h-3 w-3 text-red-400" aria-hidden="true" />
          ) : isLive ? (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="Live" />
          ) : (
            <Activity className="h-3 w-3" aria-hidden="true" />
          )}
          <span className="font-medium">Last sync:</span> {lastSync.time}
          {showLastSyncTimeoutWarning ? (
            <span
              data-testid="status-bar-last-sync-timeout-warning"
              className="rounded-sm border border-red-500/35 bg-red-500/10 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-red-400"
            >
              {lastSyncTimeoutWarningLabel}
            </span>
          ) : null}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />
          <span className="font-medium">Routing:</span> {routingLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Tag className="h-3 w-3" aria-hidden="true" />
          <span className="font-medium">Version:</span> {displayVersion}
        </span>
      </div>
    </footer>
  );
}
