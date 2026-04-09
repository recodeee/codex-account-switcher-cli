import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteAccount,
  getAccountTrends,
  importAccount,
  openAccountTerminal,
  repairAccountSnapshot,
  refreshAccountAuth,
  terminateAccountCliSessions,
  listAccounts,
  pauseAccount,
  reactivateAccount,
  useAccountLocally,
} from "@/features/accounts/api";
import type { AccountSummary } from "@/features/accounts/schemas";
import { resetQuotaDisplayFloorCacheForAccount } from "@/utils/quota-display";
import { hasActiveCliSessionSignal } from "@/utils/account-working";

const DEFAULT_ACCOUNTS_POLL_MS = 10_000;
const ACTIVE_ACCOUNTS_POLL_MS = 5_000;

function extractAccounts(data: unknown): AccountSummary[] | undefined {
  if (Array.isArray(data)) {
    return data as AccountSummary[];
  }
  if (
    data &&
    typeof data === "object" &&
    "accounts" in data &&
    Array.isArray((data as { accounts?: unknown }).accounts)
  ) {
    return (data as { accounts: AccountSummary[] }).accounts;
  }
  return undefined;
}

export function hasWorkingAccounts(data: unknown): boolean {
  const accounts = extractAccounts(data);
  if (!accounts || accounts.length === 0) {
    return false;
  }
  return accounts.some((account) => hasActiveCliSessionSignal(account));
}

export function resolveAccountsPollInterval(data: unknown): number {
  return hasWorkingAccounts(data) ? ACTIVE_ACCOUNTS_POLL_MS : DEFAULT_ACCOUNTS_POLL_MS;
}

function invalidateAccountRelatedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: ["accounts", "list"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] }),
  ]);
}

function clearAccountLiveSignals(account: AccountSummary): AccountSummary {
  return {
    ...account,
    codexLiveSessionCount: 0,
    codexTrackedSessionCount: 0,
    codexSessionCount: 0,
    codexCurrentTaskPreview: null,
    codexAuth: account.codexAuth
      ? {
          ...account.codexAuth,
          hasLiveSession: false,
        }
      : account.codexAuth,
    liveQuotaDebug: account.liveQuotaDebug
      ? {
          ...account.liveQuotaDebug,
          merged: null,
          rawSamples: [],
          overrideApplied: false,
          overrideReason: "terminated_cli_sessions",
        }
      : account.liveQuotaDebug,
  };
}

function applyOptimisticTerminationToQueryData(data: unknown, accountId: string): unknown {
  const patchEntry = (entry: unknown): unknown => {
    if (!entry || typeof entry !== "object") {
      return entry;
    }
    const maybeAccount = entry as Partial<AccountSummary>;
    if (maybeAccount.accountId !== accountId) {
      return entry;
    }
    return clearAccountLiveSignals(entry as AccountSummary);
  };

  if (Array.isArray(data)) {
    return data.map((entry) => patchEntry(entry));
  }

  if (data && typeof data === "object" && "accounts" in data && Array.isArray((data as { accounts?: unknown }).accounts)) {
    const payload = data as { accounts: unknown[] };
    return {
      ...data,
      accounts: payload.accounts.map((entry) => patchEntry(entry)),
    };
  }

  return data;
}

/**
 * Account mutation actions without the polling query.
 * Use this when you need account actions but already have account data
 * from another source (e.g. the dashboard overview query).
 */
export function useAccountMutations() {
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: importAccount,
    onSuccess: () => {
      toast.success("Account imported");
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Import failed");
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseAccount,
    onSuccess: () => {
      toast.success("Account paused");
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Pause failed");
    },
  });

  const resumeMutation = useMutation({
    mutationFn: reactivateAccount,
    onSuccess: () => {
      toast.success("Account resumed");
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Resume failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      toast.success("Account deleted");
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Delete failed");
    },
  });

  const useLocalMutation = useMutation({
    mutationFn: useAccountLocally,
    onSuccess: async (response) => {
      resetQuotaDisplayFloorCacheForAccount(response.accountId);
      toast.success(`Switched to ${response.snapshotName}`);
      await invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Switch failed");
    },
  });

  const refreshAuthMutation = useMutation({
    mutationFn: refreshAccountAuth,
    onSuccess: (response) => {
      toast.success(`Re-authenticated ${response.email}`);
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Re-authentication failed");
    },
  });

  const openTerminalMutation = useMutation({
    mutationFn: openAccountTerminal,
    onSuccess: (response) => {
      toast.success(`Opened terminal for ${response.snapshotName}`);
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to open host terminal");
    },
  });

  const terminateCliSessionsMutation = useMutation({
    mutationFn: terminateAccountCliSessions,
    onMutate: async (accountId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ["accounts", "list"] }),
        queryClient.cancelQueries({ queryKey: ["dashboard", "overview"] }),
      ]);

      const previousAccountsList = queryClient.getQueryData(["accounts", "list"]);
      const previousDashboardOverview = queryClient.getQueryData(["dashboard", "overview"]);

      queryClient.setQueryData(["accounts", "list"], (current) =>
        applyOptimisticTerminationToQueryData(current, accountId),
      );
      queryClient.setQueryData(["dashboard", "overview"], (current) =>
        applyOptimisticTerminationToQueryData(current, accountId),
      );

      return {
        previousAccountsList,
        previousDashboardOverview,
      };
    },
    onSuccess: (response) => {
      if (response.terminatedSessionCount <= 0) {
        void invalidateAccountRelatedQueries(queryClient);
        return;
      }
      const noun = response.terminatedSessionCount === 1 ? "session" : "sessions";
      toast.success(
        `Terminated ${response.terminatedSessionCount} CLI ${noun} for ${response.snapshotName}`,
      );
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error, _accountId, context) => {
      if (context) {
        queryClient.setQueryData(["accounts", "list"], context.previousAccountsList);
        queryClient.setQueryData(["dashboard", "overview"], context.previousDashboardOverview);
      }
      toast.error(error.message || "Failed to terminate CLI sessions");
    },
  });

  const repairSnapshotMutation = useMutation({
    mutationFn: (params: { accountId: string; mode: "readd" | "rename" }) =>
      repairAccountSnapshot(params.accountId, params.mode),
    onSuccess: (response) => {
      const verb = response.mode === "rename" ? "Renamed" : "Re-added";
      const detail = response.changed
        ? `${response.previousSnapshotName} → ${response.snapshotName}`
        : response.snapshotName;
      toast.success(`${verb} snapshot ${detail}`);
      void invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Snapshot repair failed");
    },
  });

  return {
    importMutation,
    pauseMutation,
    resumeMutation,
    deleteMutation,
    useLocalMutation,
    refreshAuthMutation,
    openTerminalMutation,
    terminateCliSessionsMutation,
    repairSnapshotMutation,
  };
}

export function useAccountTrends(accountId: string | null) {
  return useQuery({
    queryKey: ["accounts", "trends", accountId],
    queryFn: () => getAccountTrends(accountId!),
    enabled: !!accountId,
    staleTime: 5 * 60_000,
    refetchInterval: 5 * 60_000,
    refetchIntervalInBackground: false,
  });
}

export function useAccounts() {
  const accountsQuery = useQuery({
    queryKey: ["accounts", "list"],
    queryFn: listAccounts,
    select: (data) => data.accounts,
    refetchInterval: (query) => resolveAccountsPollInterval(query.state.data),
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  const mutations = useAccountMutations();

  return { accountsQuery, ...mutations };
}
