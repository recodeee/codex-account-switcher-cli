import { useQuery } from "@tanstack/react-query";

import { getDashboardOverview } from "@/features/dashboard/api";
import type { DashboardOverview } from "@/features/dashboard/schemas";
import { isAccountWorkingNow } from "@/utils/account-working";

const DEFAULT_DASHBOARD_POLL_MS = 30_000;
const ACTIVE_DASHBOARD_POLL_MS = 2_000;

function hasWorkingAccounts(data: DashboardOverview | undefined): boolean {
  if (!data) {
    return false;
  }
  return data.accounts.some((account) => isAccountWorkingNow(account));
}

export function useDashboard() {
  return useQuery({
    queryKey: ["dashboard", "overview"],
    queryFn: getDashboardOverview,
    refetchInterval: (query) =>
      hasWorkingAccounts(query.state.data as DashboardOverview | undefined)
        ? ACTIVE_DASHBOARD_POLL_MS
        : DEFAULT_DASHBOARD_POLL_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
}
