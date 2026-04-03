import { useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { useAccountMutations } from "@/features/accounts/hooks/use-accounts";
import { AccountCards } from "@/features/dashboard/components/account-cards";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { useTerminalWorkspace } from "@/features/dashboard/components/terminal-workspace-context";
import { RequestFilters } from "@/features/dashboard/components/filters/request-filters";
import { RecentRequestsTable } from "@/features/dashboard/components/recent-requests-table";
import { UsageDonuts } from "@/features/dashboard/components/usage-donuts";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useRequestLogs } from "@/features/dashboard/hooks/use-request-logs";
import { buildDashboardView } from "@/features/dashboard/utils";
import type { AccountSummary } from "@/features/dashboard/schemas";
import { useThemeStore } from "@/hooks/use-theme";
import { REQUEST_STATUS_LABELS } from "@/utils/constants";
import { formatModelLabel, formatSlug } from "@/utils/formatters";
import { isCodexAuthSnapshotMissingError } from "@/utils/use-local-account";

const MODEL_OPTION_DELIMITER = ":::";

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isDark = useThemeStore((s) => s.theme === "dark");
  const dashboardQuery = useDashboard();
  const { filters, logsQuery, optionsQuery, updateFilters } = useRequestLogs();
  const { resumeMutation, useLocalMutation } = useAccountMutations();
  const { openTerminal } = useTerminalWorkspace();

  const isRefreshing = dashboardQuery.isFetching || logsQuery.isFetching;

  const handleRefresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  }, [queryClient]);

  const handleAccountAction = useCallback(
    (account: AccountSummary, action: string) => {
      switch (action) {
        case "details":
          navigate(`/accounts?selected=${account.accountId}`);
          break;
        case "resume":
          resumeMutation.mutate(account.accountId);
          break;
        case "reauth":
          navigate(`/accounts?selected=${account.accountId}`);
          break;
        case "useLocal":
          useLocalMutation.mutate(account.accountId, {
            onError: (error) => {
              if (isCodexAuthSnapshotMissingError(error)) {
                navigate(`/accounts?selected=${account.accountId}`);
              }
            },
          });
          break;
        case "terminal":
          openTerminal({
            accountId: account.accountId,
            email: account.email,
          });
          break;
        case "sessions":
          navigate(`/sessions?accountId=${encodeURIComponent(account.accountId)}`);
          break;
      }
    },
    [navigate, openTerminal, resumeMutation, useLocalMutation],
  );

  const overview = dashboardQuery.data;
  const logPage = logsQuery.data;

  const view = useMemo(() => {
    if (!overview || !logPage) {
      return null;
    }
    return buildDashboardView(overview, logPage.requests, isDark);
  }, [overview, logPage, isDark]);

  const accountOptions = useMemo(() => {
    const entries = new Map<string, { label: string; isEmail: boolean }>();
    for (const account of overview?.accounts ?? []) {
      const raw = account.displayName || account.email || account.accountId;
      const isEmail = !!account.email && raw === account.email;
      entries.set(account.accountId, { label: raw, isEmail });
    }
    return (optionsQuery.data?.accountIds ?? []).map((accountId) => {
      const entry = entries.get(accountId);
      return {
        value: accountId,
        label: entry?.label ?? accountId,
        isEmail: entry?.isEmail ?? false,
      };
    });
  }, [optionsQuery.data?.accountIds, overview?.accounts]);

  const modelOptions = useMemo(
    () =>
      (optionsQuery.data?.modelOptions ?? []).map((option) => ({
        value: `${option.model}${MODEL_OPTION_DELIMITER}${option.reasoningEffort ?? ""}`,
        label: formatModelLabel(option.model, option.reasoningEffort),
      })),
    [optionsQuery.data?.modelOptions],
  );

  const statusOptions = useMemo(
    () =>
      (optionsQuery.data?.statuses ?? []).map((status) => ({
        value: status,
        label: REQUEST_STATUS_LABELS[status] ?? formatSlug(status),
      })),
    [optionsQuery.data?.statuses],
  );

  const errorMessage =
    (dashboardQuery.error instanceof Error && dashboardQuery.error.message) ||
    (logsQuery.error instanceof Error && logsQuery.error.message) ||
    (optionsQuery.error instanceof Error && optionsQuery.error.message) ||
    null;

  return (
    <div className="animate-fade-in-up space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Overview, account health, and recent request logs.
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          title="Refresh dashboard"
        >
          <RefreshCw className={`h-4 w-4${isRefreshing ? " animate-spin" : ""}`} />
        </button>
      </div>

      {errorMessage ? <AlertMessage variant="error">{errorMessage}</AlertMessage> : null}

      {!view ? (
        <DashboardSkeleton />
      ) : (
        <>
            <UsageDonuts
              primaryItems={view.primaryUsageItems}
              secondaryItems={view.secondaryUsageItems}
              primaryTotal={overview?.summary.primaryWindow.capacityCredits ?? 0}
              secondaryTotal={overview?.summary.secondaryWindow?.capacityCredits ?? 0}
              safeLinePrimary={view.safeLinePrimary}
              safeLineSecondary={view.safeLineSecondary}
            />

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">Accounts</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <AccountCards
              accounts={overview?.accounts ?? []}
              primaryWindow={overview?.windows.primary ?? null}
              secondaryWindow={overview?.windows.secondary ?? null}
              useLocalBusy={useLocalMutation.isPending}
              onAction={handleAccountAction}
            />
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">Request Logs</h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <RequestFilters
              filters={filters}
              accountOptions={accountOptions}
              modelOptions={modelOptions}
              statusOptions={statusOptions}
              onSearchChange={(search) => updateFilters({ search, offset: 0 })}
              onTimeframeChange={(timeframe) => updateFilters({ timeframe, offset: 0 })}
              onAccountChange={(accountIds) => updateFilters({ accountIds, offset: 0 })}
              onModelChange={(modelOptionsSelected) =>
                updateFilters({ modelOptions: modelOptionsSelected, offset: 0 })
              }
              onStatusChange={(statuses) => updateFilters({ statuses, offset: 0 })}
              onReset={() =>
                updateFilters({
                  search: "",
                  timeframe: "all",
                  accountIds: [],
                  modelOptions: [],
                  statuses: [],
                  offset: 0,
                })
              }
            />
            <div className="transition-opacity duration-200">
              <RecentRequestsTable
                requests={view.requestLogs}
                accounts={overview?.accounts ?? []}
                total={logPage?.total ?? 0}
                limit={filters.limit}
                offset={filters.offset}
                hasMore={logPage?.hasMore ?? false}
                onLimitChange={(limit) => updateFilters({ limit, offset: 0 })}
                onOffsetChange={(offset) => updateFilters({ offset })}
              />
            </div>
          </section>
        </>
      )}

    </div>
  );
}
