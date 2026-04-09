import { useQuery } from "@tanstack/react-query";

import { getDashboardSystemMonitor } from "@/features/dashboard/api";

const DEFAULT_SYSTEM_MONITOR_POLL_MS = 2_500;
const MIN_SYSTEM_MONITOR_POLL_MS = 1_000;

function resolveSystemMonitorPollMs(): number {
  const raw = process.env.NEXT_PUBLIC_DASHBOARD_SYSTEM_MONITOR_POLL_MS;
  if (!raw) {
    return DEFAULT_SYSTEM_MONITOR_POLL_MS;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SYSTEM_MONITOR_POLL_MS;
  }
  return Math.max(MIN_SYSTEM_MONITOR_POLL_MS, Math.floor(parsed));
}

const SYSTEM_MONITOR_POLL_MS = resolveSystemMonitorPollMs();

export function useSystemMonitor() {
  return useQuery({
    queryKey: ["dashboard", "system-monitor"],
    queryFn: getDashboardSystemMonitor,
    refetchInterval: SYSTEM_MONITOR_POLL_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
  });
}
