import { useCallback, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "@/lib/router-compat";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { AlertMessage } from "@/components/alert-message";
import { LoadingOverlay } from "@/components/layout/loading-overlay";
import { useDialogState } from "@/hooks/use-dialog-state";
import { AccountDetail } from "@/features/accounts/components/account-detail";
import { AccountList } from "@/features/accounts/components/account-list";
import { AccountsSkeleton } from "@/features/accounts/components/accounts-skeleton";
import { ImportDialog } from "@/features/accounts/components/import-dialog";
import { OauthDialog } from "@/features/accounts/components/oauth-dialog";
import { useAccounts } from "@/features/accounts/hooks/use-accounts";
import { useOauth } from "@/features/accounts/hooks/use-oauth";
import { buildDuplicateAccountIdSet } from "@/utils/account-identifiers";
import { getErrorMessageOrNull } from "@/utils/errors";
import { isCodexAuthSnapshotMissingError } from "@/utils/use-local-account";

export function AccountsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    accountsQuery,
    importMutation,
    pauseMutation,
    resumeMutation,
    deleteMutation,
    useLocalMutation,
    repairSnapshotMutation,
  } = useAccounts();
  const oauth = useOauth();

  const importDialog = useDialogState();
  const oauthDialog = useDialogState();
  const deleteDialog = useDialogState<string>();

  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);
  const duplicateAccountIds = useMemo(() => buildDuplicateAccountIdSet(accounts), [accounts]);
  const selectedAccountId = searchParams.get("selected");
  const oauthIntent = searchParams.get("oauth");
  const oauthIntentInFlightRef = useRef(false);

  const handleSelectAccount = useCallback((accountId: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("selected", accountId);
    setSearchParams(nextSearchParams);
  }, [searchParams, setSearchParams]);

  const handleUseLocal = useCallback(
    (accountId: string) => {
      useLocalMutation.mutate(accountId, {
        onError: (error) => {
          if (!isCodexAuthSnapshotMissingError(error)) {
            return;
          }
          const nextSearchParams = new URLSearchParams(searchParams);
          nextSearchParams.set("selected", accountId);
          setSearchParams(nextSearchParams);
        },
      });
    },
    [searchParams, setSearchParams, useLocalMutation],
  );

  const triggerDeviceOauth = useCallback((accountId: string) => {
    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.set("selected", accountId);
    nextSearchParams.set("oauth", "device");
    setSearchParams(nextSearchParams);
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (oauthIntent === "prompt") {
      oauthDialog.show();
      const nextSearchParams = new URLSearchParams(searchParams);
      nextSearchParams.delete("oauth");
      setSearchParams(nextSearchParams, { replace: true });
      return;
    }

    if (oauthIntent !== "device" || oauthIntentInFlightRef.current) {
      return;
    }

    oauthIntentInFlightRef.current = true;
    oauthDialog.show();

    void oauth.start("device").finally(() => {
      oauthIntentInFlightRef.current = false;
    });

    const nextSearchParams = new URLSearchParams(searchParams);
    nextSearchParams.delete("oauth");
    setSearchParams(nextSearchParams, { replace: true });
  }, [oauth, oauthDialog, oauthIntent, searchParams, setSearchParams]);

  const resolvedSelectedAccountId = useMemo(() => {
    if (accounts.length === 0) {
      return null;
    }
    if (selectedAccountId && accounts.some((account) => account.accountId === selectedAccountId)) {
      return selectedAccountId;
    }
    return accounts[0].accountId;
  }, [accounts, selectedAccountId]);

  const selectedAccount = useMemo(
    () =>
      resolvedSelectedAccountId
        ? accounts.find((account) => account.accountId === resolvedSelectedAccountId) ?? null
        : null,
    [accounts, resolvedSelectedAccountId],
  );

  const mutationBusy =
    importMutation.isPending ||
    pauseMutation.isPending ||
    resumeMutation.isPending ||
    deleteMutation.isPending ||
    useLocalMutation.isPending ||
    repairSnapshotMutation.isPending;

  const mutationError =
    getErrorMessageOrNull(importMutation.error) ||
    getErrorMessageOrNull(pauseMutation.error) ||
    getErrorMessageOrNull(resumeMutation.error) ||
    getErrorMessageOrNull(deleteMutation.error) ||
    getErrorMessageOrNull(useLocalMutation.error) ||
    getErrorMessageOrNull(repairSnapshotMutation.error);

  return (
    <div className="animate-fade-in-up space-y-6">
      {/* Page header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage imported accounts and authentication flows.
        </p>
      </div>

      {mutationError ? <AlertMessage variant="error">{mutationError}</AlertMessage> : null}

      {!accountsQuery.data ? (
        <AccountsSkeleton />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <div className="rounded-xl border bg-card p-4">
            <AccountList
              accounts={accounts}
              selectedAccountId={resolvedSelectedAccountId}
              onSelect={handleSelectAccount}
              onUseLocal={handleUseLocal}
              useLocalBusy={useLocalMutation.isPending}
              onOpenImport={() => importDialog.show()}
              onOpenOauth={() => oauthDialog.show()}
            />
          </div>

          <AccountDetail
            account={selectedAccount}
            showAccountId={selectedAccount ? duplicateAccountIds.has(selectedAccount.accountId) : false}
            busy={mutationBusy}
            onPause={(accountId) => pauseMutation.mutate(accountId)}
            onResume={(accountId) => resumeMutation.mutate(accountId)}
            onDelete={(accountId) => deleteDialog.show(accountId)}
            onUseLocal={handleUseLocal}
            onRepairSnapshot={(accountId, mode) =>
              repairSnapshotMutation.mutate({ accountId, mode })
            }
            useLocalBusy={useLocalMutation.isPending}
            repairSnapshotBusy={repairSnapshotMutation.isPending}
            onReauth={triggerDeviceOauth}
          />
        </div>
      )}

      <ImportDialog
        open={importDialog.open}
        busy={importMutation.isPending}
        error={getErrorMessageOrNull(importMutation.error)}
        onOpenChange={importDialog.onOpenChange}
        onImport={async (file) => {
          await importMutation.mutateAsync(file);
        }}
      />

      <OauthDialog
        open={oauthDialog.open}
        state={oauth.state}
        onOpenChange={oauthDialog.onOpenChange}
        onStart={async (method) => {
          await oauth.start(method);
        }}
        onComplete={async () => {
          await oauth.complete();
          await accountsQuery.refetch();
        }}
        onManualCallback={async (callbackUrl) => {
          await oauth.manualCallback(callbackUrl);
        }}
        onReset={oauth.reset}
      />

      <ConfirmDialog
        open={deleteDialog.open}
        title="Delete account"
        description="This action removes the account from the load balancer configuration."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onOpenChange={deleteDialog.onOpenChange}
        onConfirm={() => {
          if (!deleteDialog.data) {
            return;
          }
          deleteMutation.mutate(deleteDialog.data, {
            onSettled: () => {
              deleteDialog.hide();
            },
          });
        }}
      />

      <LoadingOverlay visible={!!accountsQuery.data && mutationBusy} label="Updating accounts..." />
    </div>
  );
}
