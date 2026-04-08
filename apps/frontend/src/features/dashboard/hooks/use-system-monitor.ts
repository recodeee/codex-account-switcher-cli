import { useQuery } from "@tanstack/react-query";

import { getDashboardSystemMonitor } from "@/features/dashboard/api";

const SYSTEM_MONITOR_POLL_MS = 1_000;

export function useSystemMonitor() {
  return useQuery({
    queryKey: ["dashboard", "system-monitor"],
    queryFn: getDashboardSystemMonitor,
    refetchInterval: SYSTEM_MONITOR_POLL_MS,
    refetchIntervalInBackground: true,
    retry: false,
    staleTime: 0,
  });
}
