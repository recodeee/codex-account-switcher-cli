import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { getDashboardOverview } from "@/features/dashboard/api";
import type { DashboardOverview } from "@/features/dashboard/schemas";
import { DashboardOverviewSchema } from "@/features/dashboard/schemas";
import {
  loadMedusaCustomerDashboardOverviewState,
  saveMedusaCustomerDashboardOverviewState,
} from "@/features/medusa-customer-auth/api";
import { useMedusaCustomerAuthStore } from "@/features/medusa-customer-auth/hooks/use-medusa-customer-auth";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

const DEFAULT_DASHBOARD_POLL_MS = 10_000;
const ACTIVE_DASHBOARD_POLL_MS = 5_000;
const WEBSOCKET_CONNECTED_SAFETY_POLL_MS = 5_000;
const MAX_DASHBOARD_METADATA_CHARS = 200_000;

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
  const queryClient = useQueryClient();
  const medusaToken = useMedusaCustomerAuthStore((state) => state.token);
  const websocketConnected = options.websocketConnected ?? false;
  const hydratedTokenRef = useRef<string | null>(null);
  const lastSavedSnapshotRef = useRef<string | null>(null);

  const dashboardQuery = useQuery({
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

  useEffect(() => {
    if (!medusaToken) {
      hydratedTokenRef.current = null;
      return;
    }

    if (hydratedTokenRef.current === medusaToken) {
      return;
    }
    hydratedTokenRef.current = medusaToken;

    void loadMedusaCustomerDashboardOverviewState(medusaToken)
      .then((cachedState) => {
        if (!cachedState) {
          return;
        }
        const parsed = DashboardOverviewSchema.safeParse(cachedState);
        if (!parsed.success) {
          return;
        }

        queryClient.setQueryData(
          ["dashboard", "overview"],
          (current: DashboardOverview | undefined) => current ?? parsed.data,
        );
      })
      .catch(() => {
        // Cache hydration is best-effort and must not block live overview fetches.
      });
  }, [medusaToken, queryClient]);

  useEffect(() => {
    if (!medusaToken || !dashboardQuery.data) {
      return;
    }

    const serializedSnapshot = JSON.stringify(dashboardQuery.data);
    if (serializedSnapshot.length > MAX_DASHBOARD_METADATA_CHARS) {
      return;
    }
    if (lastSavedSnapshotRef.current === serializedSnapshot) {
      return;
    }
    lastSavedSnapshotRef.current = serializedSnapshot;

    void saveMedusaCustomerDashboardOverviewState(medusaToken, dashboardQuery.data).catch(() => {
      // Cache persistence is best-effort and must not disrupt the dashboard query flow.
    });
  }, [dashboardQuery.data, medusaToken]);

  return dashboardQuery;
}
