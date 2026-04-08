import { useQuery } from "@tanstack/react-query";

import { getDashboardOverview } from "@/features/dashboard/api";
import type { DashboardOverview } from "@/features/dashboard/schemas";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

const DEFAULT_DASHBOARD_POLL_MS = 10_000;
const ACTIVE_DASHBOARD_POLL_MS = 5_000;
const WEBSOCKET_CONNECTED_SAFETY_POLL_MS = 60_000;

function hasWorkingAccounts(data: DashboardOverview | undefined): boolean {
  if (!data) {
    return false;
  }
  return data.accounts.some((account) => hasActiveCliSessionSignal(account));
}

type UseDashboardOptions = {
  websocketConnected?: boolean;
};

export function useDashboard(options: UseDashboardOptions = {}) {
  const websocketConnected = options.websocketConnected ?? false;
  return useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    refetchInterval: (query) =>
      websocketConnected
        ? WEBSOCKET_CONNECTED_SAFETY_POLL_MS
        : hasWorkingAccounts(query.state.data as DashboardOverview | undefined)
          ? ACTIVE_DASHBOARD_POLL_MS
          : DEFAULT_DASHBOARD_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}
