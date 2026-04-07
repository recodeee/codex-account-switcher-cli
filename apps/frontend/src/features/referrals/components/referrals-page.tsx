import { useMemo } from "react";

import { AlertMessage } from "@/components/alert-message";
import { CopyButton } from "@/components/copy-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { buildReferralLink } from "@/features/referrals/utils";
import { getErrorMessageOrNull } from "@/utils/errors";

export function ReferralsPage() {
  const dashboardQuery = useDashboard();

  const rows = useMemo(() => {
    const accounts = dashboardQuery.data?.accounts ?? [];
    return [...accounts]
      .sort((a, b) => a.email.localeCompare(b.email))
      .map((account) => ({
        accountId: account.accountId,
        email: account.email,
        displayName: account.displayName,
        referralLink: buildReferralLink(account.accountId),
      }));
  }, [dashboardQuery.data?.accounts]);

  const queryError = getErrorMessageOrNull(dashboardQuery.error);

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Referrals</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every user gets an auto-generated referral link based on their account.
        </p>
      </div>

      {queryError ? (
        <div className="space-y-3 rounded-xl border bg-card p-4">
          <AlertMessage variant="error">{queryError}</AlertMessage>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void dashboardQuery.refetch();
            }}
            disabled={dashboardQuery.isFetching}
          >
            Retry
          </Button>
        </div>
      ) : null}

      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm text-muted-foreground">
          Total referral users: <span className="font-medium text-foreground">{rows.length}</span>
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>User</TableHead>
              <TableHead>Account ID</TableHead>
              <TableHead>Referral link</TableHead>
              <TableHead className="text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dashboardQuery.isPending && rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  Loading referral links…
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-muted-foreground">
                  No users available.
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.accountId}>
                  <TableCell className="font-medium">{row.displayName || row.email}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.accountId}
                  </TableCell>
                  <TableCell className="max-w-[520px]">
                    <p className="truncate text-xs text-muted-foreground">{row.referralLink}</p>
                  </TableCell>
                  <TableCell className="text-right">
                    <CopyButton value={row.referralLink} label="Copy link" />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
