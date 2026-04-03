import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import {
  deleteAccount,
  getAccountTrends,
  importAccount,
  openAccountTerminal,
  repairAccountSnapshot,
  refreshAccountAuth,
  listAccounts,
  pauseAccount,
  reactivateAccount,
  useAccountLocally,
} from "@/features/accounts/api";
import type { AccountSummary } from "@/features/accounts/schemas";
import { isAccountWorkingNow } from "@/utils/account-working";

const DEFAULT_ACCOUNTS_POLL_MS = 30_000;
const ACTIVE_ACCOUNTS_POLL_MS = 2_000;

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
  return accounts.some((account) => isAccountWorkingNow(account));
}

export function resolveAccountsPollInterval(data: unknown): number {
  return hasWorkingAccounts(data) ? ACTIVE_ACCOUNTS_POLL_MS : DEFAULT_ACCOUNTS_POLL_MS;
}

function invalidateAccountRelatedQueries(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ["accounts", "list"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard", "overview"] });
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
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Import failed");
    },
  });

  const pauseMutation = useMutation({
    mutationFn: pauseAccount,
    onSuccess: () => {
      toast.success("Account paused");
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Pause failed");
    },
  });

  const resumeMutation = useMutation({
    mutationFn: reactivateAccount,
    onSuccess: () => {
      toast.success("Account resumed");
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Resume failed");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteAccount,
    onSuccess: () => {
      toast.success("Account deleted");
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Delete failed");
    },
  });

  const useLocalMutation = useMutation({
    mutationFn: useAccountLocally,
    onSuccess: (response) => {
      toast.success(`Switched to ${response.snapshotName}`);
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Switch failed");
    },
  });

  const refreshAuthMutation = useMutation({
    mutationFn: refreshAccountAuth,
    onSuccess: (response) => {
      toast.success(`Re-authenticated ${response.email}`);
      invalidateAccountRelatedQueries(queryClient);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Re-authentication failed");
    },
  });

  const openTerminalMutation = useMutation({
    mutationFn: openAccountTerminal,
    onSuccess: (response) => {
      toast.success(`Opened terminal for ${response.snapshotName}`);
      invalidateAccountRelatedQueries(queryClient);
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
      invalidateAccountRelatedQueries(queryClient);
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
