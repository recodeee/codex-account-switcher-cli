import { format } from "date-fns";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CreditCard,
  Eye,
  Plus,
  ShieldCheck,
  Sparkles,
  Users2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { SpinnerBlock } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBilling } from "@/features/billing/hooks/use-billing";
import type { BillingAccount, BillingAccountCreateRequest } from "@/features/billing/schemas";
import { getErrorMessageOrNull } from "@/utils/errors";

function formatStatusLabel(value: BillingAccount["subscriptionStatus"] | BillingAccount["paymentStatus"]) {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function formatDisplayDate(value: Date | string | null | undefined): string {
  if (!value) {
    return "—";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return format(date, "MMM d, yyyy");
}

function getInitials(value: string): string {
  const words = value
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) {
    return "?";
  }

  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }

  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

const DEFAULT_CREATE_ACCOUNT_FORM: Pick<BillingAccountCreateRequest, "domain" | "planCode" | "planName"> = {
  domain: "",
  planCode: "business",
  planName: "Business",
};

export function BillingPage() {
  const { billingQuery, createAccountMutation } = useBilling();
  const [selectedBusinessAccountId, setSelectedBusinessAccountId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_ACCOUNT_FORM);
  const [createFormError, setCreateFormError] = useState<string | null>(null);

  const accounts = useMemo(() => billingQuery.data?.accounts ?? [], [billingQuery.data]);
  const selectedBusinessAccount = useMemo(
    () =>
      selectedBusinessAccountId === null
        ? null
        : accounts.find((account) => account.id === selectedBusinessAccountId) ?? null,
    [accounts, selectedBusinessAccountId],
  );

  const entitledCount = useMemo(
    () => accounts.filter((account) => account.entitled).length,
    [accounts],
  );
  const totalChatgptSeats = useMemo(
    () => accounts.reduce((sum, account) => sum + account.chatgptSeatsInUse, 0),
    [accounts],
  );
  const totalCodexSeats = useMemo(
    () => accounts.reduce((sum, account) => sum + account.codexSeatsInUse, 0),
    [accounts],
  );
  const notEntitledCount = accounts.length - entitledCount;
  const errorMessage = getErrorMessageOrNull(
    billingQuery.error,
    "Failed to load live billing summary.",
  );
  const createPending = createAccountMutation.isPending;

  async function handleCreateSubscriptionAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const domain = createForm.domain.trim();
    if (!domain) {
      setCreateFormError("Domain is required.");
      return;
    }

    setCreateFormError(null);

    try {
      await createAccountMutation.mutateAsync({
        domain,
        planCode: createForm.planCode.trim() || "business",
        planName: createForm.planName.trim() || "Business",
      });
      setCreateForm(DEFAULT_CREATE_ACCOUNT_FORM);
      setCreateDialogOpen(false);
    } catch (error) {
      setCreateFormError(getErrorMessageOrNull(error, "Failed to add subscription account."));
    }
  }

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-card via-card to-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Live subscription state from Medusa
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Review live plan status, entitlement state, renewals, and seat usage for billed accounts.
            </p>
          </div>
        </div>
      </div>

      {(billingQuery.isLoading || billingQuery.isPending) && !billingQuery.data ? (
        <Card className="border-border/70">
          <CardContent className="py-10">
            <SpinnerBlock label="Loading live billing summary..." />
          </CardContent>
        </Card>
      ) : billingQuery.isError ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex flex-col gap-3 py-8">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600">
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Live billing summary unavailable
                </p>
                <p className="text-sm text-muted-foreground">{errorMessage}</p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Billing falls closed when Medusa cannot provide trustworthy subscription state.
            </p>
          </CardContent>
        </Card>
      ) : accounts.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No billed accounts yet"
          description="Medusa has not returned any subscription accounts for this dashboard."
        />
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Billed accounts
              </p>
              <p className="mt-2 text-2xl font-semibold">{accounts.length}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Entitled accounts
              </p>
              <p className="mt-2 text-2xl font-semibold">
                {entitledCount} of {accounts.length}
              </p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                ChatGPT seats in use
              </p>
              <p className="mt-2 text-2xl font-semibold">{totalChatgptSeats}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Codex seats in use
              </p>
              <p className="mt-2 text-2xl font-semibold">{totalCodexSeats}</p>
            </div>
          </div>

          {notEntitledCount > 0 ? (
            <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-200">
              {notEntitledCount} account{notEntitledCount === 1 ? "" : "s"} currently not entitled. Review plan
              status and payment health before granting premium dashboard access.
            </div>
          ) : (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-200">
              All billed accounts are currently entitled for premium dashboard access.
            </div>
          )}

          <Card className="overflow-hidden border-border/70">
            <CardHeader className="space-y-4 bg-card/70 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle className="text-3xl">Subscription accounts</CardTitle>
                    <Badge variant="secondary">Live</Badge>
                  </div>
                  <p className="mt-2 flex items-center gap-2 text-base text-muted-foreground">
                    <CalendarClock className="h-4 w-4" aria-hidden="true" />
                    Renewals and entitlement state are read directly from Medusa.
                  </p>
                </div>
                <Button
                  type="button"
                  onClick={() => {
                    setCreateFormError(null);
                    setCreateDialogOpen(true);
                  }}
                >
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  Add subscription account
                </Button>
              </div>
            </CardHeader>

            <CardContent className="space-y-5 pt-6">
              <div className="overflow-hidden rounded-xl border border-border/70">
                <Table>
                  <TableHeader className="bg-muted/30">
                    <TableRow>
                      <TableHead>Business account</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Subscription</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Renewal</TableHead>
                      <TableHead>Seats</TableHead>
                      <TableHead className="w-[130px] text-right">Accounts list</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accounts.map((account) => (
                      <TableRow key={account.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground">
                              {account.domain.slice(0, 1)}
                            </div>
                            <div>
                              <div className="font-medium">{account.domain}</div>
                              <div className="text-xs text-muted-foreground">{account.id}</div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <p className="font-medium">{account.planName}</p>
                            <p className="text-xs uppercase tracking-wide text-muted-foreground">
                              {account.planCode}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={account.entitled ? "secondary" : "outline"}>
                              {formatStatusLabel(account.subscriptionStatus)}
                            </Badge>
                            {!account.entitled ? (
                              <Badge variant="destructive">Not entitled</Badge>
                            ) : (
                              <Badge className="bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
                                Entitled
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm">
                            <CreditCard className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                            {formatStatusLabel(account.paymentStatus)}
                          </div>
                        </TableCell>
                        <TableCell>{formatDisplayDate(account.renewalAt)}</TableCell>
                        <TableCell>
                          {account.chatgptSeatsInUse} ChatGPT · {account.codexSeatsInUse} Codex
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-full px-3"
                            aria-label={`Watch ${account.domain} accounts list`}
                            onClick={() => setSelectedBusinessAccountId(account.id)}
                          >
                            <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                            Watch
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Dialog
            open={createDialogOpen}
            onOpenChange={(open) => {
              setCreateDialogOpen(open);
              if (!open) {
                setCreateForm(DEFAULT_CREATE_ACCOUNT_FORM);
                setCreateFormError(null);
              }
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Add subscription account</DialogTitle>
                <DialogDescription>
                  Create a new billed account entry in the live subscription summary.
                </DialogDescription>
              </DialogHeader>

              <form className="space-y-4" onSubmit={handleCreateSubscriptionAccount}>
                <div className="space-y-2">
                  <Label htmlFor="billing-create-domain">Business domain</Label>
                  <Input
                    id="billing-create-domain"
                    autoFocus
                    placeholder="example.com"
                    value={createForm.domain}
                    onChange={(event) =>
                      setCreateForm((current) => ({ ...current, domain: event.target.value }))
                    }
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="billing-create-plan-name">Plan name</Label>
                    <Input
                      id="billing-create-plan-name"
                      placeholder="Business"
                      value={createForm.planName}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, planName: event.target.value }))
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="billing-create-plan-code">Plan code</Label>
                    <Input
                      id="billing-create-plan-code"
                      placeholder="business"
                      value={createForm.planCode}
                      onChange={(event) =>
                        setCreateForm((current) => ({ ...current, planCode: event.target.value }))
                      }
                    />
                  </div>
                </div>

                {createFormError ? (
                  <p className="text-sm text-destructive">{createFormError}</p>
                ) : null}

                <DialogFooter>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setCreateDialogOpen(false);
                    }}
                    disabled={createPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createPending}>
                    {createPending ? "Adding..." : "Add account"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={selectedBusinessAccountId !== null}
            onOpenChange={(open) => {
              if (!open) {
                setSelectedBusinessAccountId(null);
              }
            }}
          >
            <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] 2xl:max-w-[1200px]">
              <DialogHeader>
                <DialogTitle>{selectedBusinessAccount?.domain} · Accounts list</DialogTitle>
                <DialogDescription>
                  {selectedBusinessAccount
                    ? `${selectedBusinessAccount.planName} · ${formatStatusLabel(
                        selectedBusinessAccount.subscriptionStatus,
                      )} · Renews ${formatDisplayDate(selectedBusinessAccount.renewalAt)}`
                    : "Live subscription members and seat assignments."}
                </DialogDescription>
              </DialogHeader>

              {selectedBusinessAccount ? (
                <div className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Entitlement
                      </p>
                      <p className="mt-1.5 text-xl font-semibold">
                        {selectedBusinessAccount.entitled ? "Active" : "Blocked"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <CalendarClock className="h-3.5 w-3.5" />
                        Billing cycle
                      </p>
                      <p className="mt-1.5 text-sm font-semibold">
                        {formatDisplayDate(selectedBusinessAccount.billingCycle.start)} –{" "}
                        {formatDisplayDate(selectedBusinessAccount.billingCycle.end)}
                      </p>
                    </div>
                    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
                      <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                        <Users2 className="h-3.5 w-3.5" />
                        Seats in use
                      </p>
                      <p className="mt-1.5 text-sm font-semibold">
                        {selectedBusinessAccount.chatgptSeatsInUse} ChatGPT ·{" "}
                        {selectedBusinessAccount.codexSeatsInUse} Codex
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="overflow-hidden rounded-xl border border-border/70">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Seat type</TableHead>
                          <TableHead>Date added</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedBusinessAccount.members.map((member) => (
                          <TableRow key={member.id}>
                            <TableCell>
                              <div className="flex items-center gap-3">
                                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[11px] font-semibold uppercase text-white">
                                  {getInitials(member.name)}
                                </div>
                                <div>
                                  <p className="font-medium">{member.name}</p>
                                  <p className="text-sm text-muted-foreground">{member.email}</p>
                                </div>
                              </div>
                            </TableCell>
                            <TableCell>{member.role}</TableCell>
                            <TableCell>{member.seatType}</TableCell>
                            <TableCell>{formatDisplayDate(member.dateAdded)}</TableCell>
                          </TableRow>
                        ))}
                        {selectedBusinessAccount.members.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={4}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              This business account has no members.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
