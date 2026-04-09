import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "@/lib/router-compat";
import { useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";

import { AlertMessage } from "@/components/alert-message";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { useDialogState } from "@/hooks/use-dialog-state";
import { useAccountMutations } from "@/features/accounts/hooks/use-accounts";
import { AccountCards } from "@/features/dashboard/components/account-cards";
import { DashboardSkeleton } from "@/features/dashboard/components/dashboard-skeleton";
import { RequestFilters } from "@/features/dashboard/components/filters/request-filters";
import { RequestLogUsageDonuts } from "@/features/dashboard/components/request-log-usage-donuts";
import { RecentRequestsTable } from "@/features/dashboard/components/recent-requests-table";
import { mergeRequestLogUsageSummaryWithLiveFallback } from "@/features/dashboard/request-log-usage-fallback";
import { UsageDonuts } from "@/features/dashboard/components/usage-donuts";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { useDashboardLiveSocket } from "@/features/dashboard/hooks/use-dashboard-live-socket";
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
  const [manualRefreshInFlight, setManualRefreshInFlight] = useState(false);
  const isDark = useThemeStore((s) => s.theme === "dark");
  const dashboardLiveSocketConnected = useDashboardLiveSocket();
  const dashboardQuery = useDashboard({ websocketConnected: dashboardLiveSocketConnected });
  const { filters, logsQuery, optionsQuery, usageSummaryQuery, updateFilters } =
    useRequestLogs();
  const {
    deleteMutation,
    resumeMutation,
    useLocalMutation,
    openTerminalMutation,
    terminateCliSessionsMutation,
    repairSnapshotMutation,
  } = useAccountMutations();
  const deleteDialog = useDialogState<{ accountId: string; label: string }>();

  const isRefreshing =
    manualRefreshInFlight ||
    dashboardQuery.isPending ||
    logsQuery.isPending ||
    usageSummaryQuery.isPending;

  const handleRefresh = useCallback(() => {
    const run = async () => {
      setManualRefreshInFlight(true);
      try {
        await queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      } finally {
        setManualRefreshInFlight(false);
      }
    };

    void run();
  }, [queryClient]);

  const handleAccountAction = useCallback(
    (
      account: AccountSummary,
      action: string,
      context?: { focusSessionKey?: string; source?: "session-panel" | "watch-logs" },
    ) => {
      switch (action) {
        case "details":
          navigate(`/accounts?selected=${encodeURIComponent(account.accountId)}`);
          break;
        case "resume":
          resumeMutation.mutate(account.accountId);
          break;
        case "reauth":
          navigate(
            `/accounts?selected=${encodeURIComponent(account.accountId)}&oauth=prompt`,
          );
          break;
        case "useLocal":
          useLocalMutation.mutate(account.accountId, {
            onError: (error) => {
              if (isCodexAuthSnapshotMissingError(error)) {
                navigate(
                  `/accounts?selected=${encodeURIComponent(account.accountId)}`,
                );
              }
            },
          });
          break;
        case "terminal":
          openTerminalMutation.mutate(account.accountId);
          break;
        case "sessions":
          {
            const searchParams = new URLSearchParams({
              accountId: account.accountId,
            });
            const focusSessionKey = context?.focusSessionKey?.trim();
            if (focusSessionKey) {
              searchParams.set("sessionKey", focusSessionKey);
            }
            if (context?.source === "watch-logs") {
              searchParams.set("view", "watch");
            }
            navigate(`/sessions?${searchParams.toString()}`);
          }
          break;
        case "delete":
          deleteDialog.show({
            accountId: account.accountId,
            label: account.displayName || account.email || account.accountId,
          });
          break;
        case "terminateCliSessions":
          terminateCliSessionsMutation.mutate(account.accountId);
          break;
        case "repairSnapshotReadd":
          repairSnapshotMutation.mutate({
            accountId: account.accountId,
            mode: "readd",
          });
          break;
        case "repairSnapshotRename":
          repairSnapshotMutation.mutate({
            accountId: account.accountId,
            mode: "rename",
          });
          break;
      }
    },
    [
      navigate,
      deleteDialog,
      openTerminalMutation,
      repairSnapshotMutation,
      resumeMutation,
      terminateCliSessionsMutation,
      useLocalMutation,
    ],
  );

  const overview = dashboardQuery.data;
  const logPage = logsQuery.data;
  const hasAnyRequestLogs = (logPage?.total ?? 0) > 0;
  const mergedUsageSummary = useMemo(
    () =>
      mergeRequestLogUsageSummaryWithLiveFallback(
        usageSummaryQuery.data,
        overview?.windows,
        overview?.accounts,
      ),
    [overview?.accounts, overview?.windows, usageSummaryQuery.data],
  );

  const view = useMemo(() => {
    if (!overview) {
      return null;
    }
    return buildDashboardView(overview, logPage?.requests ?? [], isDark);
  }, [overview, logPage?.requests, isDark]);

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
    (usageSummaryQuery.error instanceof Error &&
      usageSummaryQuery.error.message) ||
    null;
  const useLocalBusyAccountId =
    useLocalMutation.isPending && typeof useLocalMutation.variables === "string"
      ? useLocalMutation.variables
      : null;

  return (
    <div className="animate-fade-in-up space-y-8">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
            <Badge
              variant="secondary"
              className="border border-border/70 bg-muted/70 text-[11px]"
            >
              Live
            </Badge>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
          title="Refresh dashboard"
        >
          <RefreshCw
            className={`h-4 w-4${isRefreshing ? " animate-spin" : ""}`}
          />
        </button>
      </div>

      {errorMessage ? (
        <AlertMessage variant="error">{errorMessage}</AlertMessage>
      ) : null}

      {!overview || !view ? (
        <DashboardSkeleton />
      ) : (
        <>
          <UsageDonuts
            primaryItems={view.primaryUsageItems}
            secondaryItems={view.secondaryUsageItems}
            primaryTotal={view.primaryTotal}
            secondaryTotal={view.secondaryTotal}
            primaryWindowMinutes={
              overview?.summary.primaryWindow.windowMinutes ?? null
            }
            safeLinePrimary={view.safeLinePrimary}
            safeLineSecondary={view.safeLineSecondary}
          />

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
                Accounts
              </h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <AccountCards
              accounts={overview?.accounts ?? []}
              primaryWindow={overview?.windows.primary ?? null}
              secondaryWindow={overview?.windows.secondary ?? null}
              primaryUsageSummary={mergedUsageSummary.usageSummary.last5h}
              useLocalBusy={useLocalMutation.isPending}
              useLocalBusyAccountId={useLocalBusyAccountId}
              deleteBusy={deleteMutation.isPending}
              onAction={handleAccountAction}
            />
          </section>

          <section className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-[13px] font-medium uppercase tracking-wider text-muted-foreground">
                Request Logs
              </h2>
              <div className="h-px flex-1 bg-border" />
            </div>
            <RequestLogUsageDonuts
              accounts={overview?.accounts ?? []}
              usageSummary={mergedUsageSummary.usageSummary}
              fallback={mergedUsageSummary.fallback}
              primaryWindowMinutes={
                overview?.summary.primaryWindow.windowMinutes ?? null
              }
            />
            {hasAnyRequestLogs ? (
              <RequestFilters
                filters={filters}
                accountOptions={accountOptions}
                modelOptions={modelOptions}
                statusOptions={statusOptions}
                onSearchChange={(search) =>
                  updateFilters({ search, offset: 0 })
                }
                onTimeframeChange={(timeframe) =>
                  updateFilters({ timeframe, offset: 0 })
                }
                onAccountChange={(accountIds) =>
                  updateFilters({ accountIds, offset: 0 })
                }
                onModelChange={(modelOptionsSelected) =>
                  updateFilters({
                    modelOptions: modelOptionsSelected,
                    offset: 0,
                  })
                }
                onStatusChange={(statuses) =>
                  updateFilters({ statuses, offset: 0 })
                }
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
            ) : null}
            {hasAnyRequestLogs && view.requestLogs.length > 0 ? (
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
            ) : null}
          </section>
        </>
      )}

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete account"
        description={
          deleteDialog.data
            ? `Remove ${deleteDialog.data.label} from the load balancer configuration.`
            : "This action removes the account from the load balancer configuration."
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={() => {
          if (!deleteDialog.data) {
            return;
          }
          deleteMutation.mutate(deleteDialog.data.accountId, {
            onSettled: () => {
              deleteDialog.hide();
            },
          });
        }}
      />
    </div>
  );
}
