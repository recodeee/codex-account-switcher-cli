import { Copy, ExternalLink, Link2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { AlertMessage } from "@/components/alert-message";
import { Button } from "@/components/ui/button";
import { SpinnerBlock } from "@/components/ui/spinner";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { buildReferralLink } from "@/features/referrals/utils";
import { getErrorMessageOrNull } from "@/utils/errors";

export function ReferralsPage() {
  const dashboardQuery = useDashboard();
  const [copiedPrimaryLink, setCopiedPrimaryLink] = useState(false);
  const [copiedRowAccountId, setCopiedRowAccountId] = useState<string | null>(null);

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
  const primaryInviteLink = rows[0]?.referralLink ?? null;

  const handleCopyReferralLink = async (link: string, accountId: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopiedRowAccountId(accountId);
      toast.success("Copied to clipboard");
      setTimeout(() => {
        setCopiedRowAccountId((previous) =>
          previous === accountId ? null : previous,
        );
      }, 1200);
    } catch {
      toast.error("Failed to copy invite link");
    }
  };

  const handleCopyPrimaryInviteLink = async () => {
    if (!primaryInviteLink) {
      return;
    }
    try {
      await navigator.clipboard.writeText(primaryInviteLink);
      setCopiedPrimaryLink(true);
      toast.success("Primary invite link copied");
      setTimeout(() => setCopiedPrimaryLink(false), 1200);
    } catch {
      toast.error("Failed to copy invite link");
    }
  };

  return (
    <div className="animate-fade-in-up min-h-[72vh] px-4 py-8">
      <div className="mx-auto flex w-full max-w-5xl items-center justify-center">
        <div className="w-full max-w-[28.5rem] space-y-4">
          <div>
            <h1 className="sr-only">Referrals</h1>
            <p className="text-base font-semibold tracking-tight text-zinc-100">
              Invite referral links
            </p>
            <p className="mt-1 text-xs text-zinc-400">
              Every user gets an auto-generated referral link based on their account.
            </p>
          </div>

          <span className="inline-flex items-center gap-2 rounded-md border border-white/10 bg-card/70 px-2.5 py-1 text-[11px] text-muted-foreground">
            <Users className="h-3.5 w-3.5" />
            Total referral users: <span className="font-semibold text-foreground">{rows.length}</span>
          </span>

          <div className="rounded-xl border border-white/10 bg-[#0A1018]/90 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_16px_40px_rgba(0,0,0,0.45)]">
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-tight text-zinc-100">Invite access</p>
              <p className="text-[11px] text-zinc-400">
                Manage and copy referral links for each account.
              </p>
            </div>

            {queryError ? (
              <div className="mt-3 space-y-2 rounded-lg border border-white/10 bg-black/25 p-3">
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

            <div className="mt-3 overflow-hidden rounded-lg border border-white/10 bg-black/30">
              <div className="divide-y divide-white/10">
                {dashboardQuery.isPending && rows.length === 0 ? (
                  <div className="px-3 py-4">
                    <SpinnerBlock label="Loading referral links…" className="gap-2" />
                  </div>
                ) : rows.length === 0 ? (
                  <div className="px-3 py-4 text-sm text-muted-foreground">No users available.</div>
                ) : (
                  rows.map((row) => (
                    <div key={row.accountId} className="flex items-center gap-2 px-3 py-2.5">
                      <span
                        aria-hidden
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-[11px] font-semibold uppercase text-zinc-200"
                      >
                        {(row.displayName || row.email).slice(0, 2)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-zinc-100">
                          {row.displayName || row.email}
                        </p>
                        <p className="truncate text-[11px] text-zinc-400">{row.email}</p>
                        <a
                          href={row.referralLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 block truncate text-[11px] text-cyan-300/85 transition-colors hover:text-cyan-200 hover:underline"
                          title={row.referralLink}
                        >
                          {row.referralLink}
                        </a>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button asChild type="button" variant="outline" size="icon">
                          <a
                            href={row.referralLink}
                            target="_blank"
                            rel="noreferrer"
                            aria-label={`Open referral link for ${row.email}`}
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label="Copy link"
                          onClick={() => {
                            void handleCopyReferralLink(row.referralLink, row.accountId);
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <Button
              type="button"
              className="mt-3 h-9 w-full text-xs"
              disabled={!primaryInviteLink}
              onClick={() => {
                void handleCopyPrimaryInviteLink();
              }}
            >
              <Link2 className="mr-2 h-3.5 w-3.5" />
              {copiedPrimaryLink
                ? "Copied primary invite link"
                : copiedRowAccountId
                  ? "Copied link"
                  : "+ Copy primary invite link"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
