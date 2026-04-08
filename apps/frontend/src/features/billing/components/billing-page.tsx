import { format } from "date-fns";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CreditCard,
  Eye,
  PencilLine,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { SpinnerBlock } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBilling } from "@/features/billing/hooks/use-billing";
import { buildManagedMembersByBillingAccount, getSeatUsageFromMembers } from "@/features/billing/member-assignment";
import type { BillingAccount, BillingAccountCreateRequest, BillingMember } from "@/features/billing/schemas";
import { useDashboard } from "@/features/dashboard/hooks/use-dashboard";
import { getErrorMessageOrNull } from "@/utils/errors";
import { formatEuro } from "@/utils/formatters";

const SUBSCRIPTION_STATUS_OPTIONS: BillingAccount["subscriptionStatus"][] = [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "expired",
];
const PAYMENT_STATUS_OPTIONS: BillingAccount["paymentStatus"][] = [
  "paid",
  "requires_action",
  "past_due",
  "unpaid",
];
const CHATGPT_SEAT_MONTHLY_PRICE_EUR = 26;
const CODEX_SEAT_MONTHLY_PRICE_EUR = 0;

type EditAccountForm = {
  planName: string;
  planCode: string;
  subscriptionStatus: BillingAccount["subscriptionStatus"];
  paymentStatus: BillingAccount["paymentStatus"];
  entitled: boolean;
  renewalAt: string;
  chatgptSeatsInUse: string;
  codexSeatsInUse: string;
};

type AccountListForm = {
  name: string;
  email: string;
};

function formatStatusLabel(value: BillingAccount["subscriptionStatus"] | BillingAccount["paymentStatus"]) {
  const normalized = value.replaceAll("_", " ");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function shouldShowPlanCode(planName: string, planCode: string): boolean {
  const normalizedPlanName = planName.trim().toLowerCase();
  const normalizedPlanCode = planCode.trim().toLowerCase();
  if (!normalizedPlanCode) {
    return false;
  }
  if (!normalizedPlanName) {
    return true;
  }
  return normalizedPlanName !== normalizedPlanCode;
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

function formatDateInputValue(value: Date | string | null | undefined): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return format(date, "yyyy-MM-dd");
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

function getEditFormFromAccount(account: BillingAccount): EditAccountForm {
  return {
    planName: account.planName,
    planCode: account.planCode,
    subscriptionStatus: account.subscriptionStatus,
    paymentStatus: account.paymentStatus,
    entitled: account.entitled,
    renewalAt: formatDateInputValue(account.renewalAt),
    chatgptSeatsInUse: String(account.chatgptSeatsInUse),
    codexSeatsInUse: String(account.codexSeatsInUse),
  };
}

const DEFAULT_CREATE_ACCOUNT_FORM: Pick<BillingAccountCreateRequest, "domain" | "planCode" | "planName"> = {
  domain: "",
  planCode: "business",
  planName: "Business",
};

const DEFAULT_EDIT_ACCOUNT_FORM: EditAccountForm = {
  planName: "",
  planCode: "business",
  subscriptionStatus: "active",
  paymentStatus: "paid",
  entitled: true,
  renewalAt: "",
  chatgptSeatsInUse: "0",
  codexSeatsInUse: "0",
};

const DEFAULT_ACCOUNT_LIST_FORM: AccountListForm = {
  name: "",
  email: "",
};

export function BillingPage() {
  const {
    billingQuery,
    updateAccountsMutation,
    createAccountMutation,
    deleteAccountMutation,
  } = useBilling();
  const dashboardQuery = useDashboard();
  const [selectedBusinessAccountId, setSelectedBusinessAccountId] = useState<string | null>(null);
  const [editingBusinessAccountId, setEditingBusinessAccountId] = useState<string | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState(DEFAULT_EDIT_ACCOUNT_FORM);
  const [editFormError, setEditFormError] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_ACCOUNT_FORM);
  const [createFormError, setCreateFormError] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deletingBusinessAccountId, setDeletingBusinessAccountId] = useState<string | null>(null);
  const [deleteFormError, setDeleteFormError] = useState<string | null>(null);
  const [accountListMembers, setAccountListMembers] = useState<BillingMember[]>([]);
  const [accountListForm, setAccountListForm] = useState(DEFAULT_ACCOUNT_LIST_FORM);
  const [accountListFormOpen, setAccountListFormOpen] = useState(false);
  const [accountListError, setAccountListError] = useState<string | null>(null);

  const accounts = useMemo(() => billingQuery.data?.accounts ?? [], [billingQuery.data]);
  const managedMembersByBillingAccount = useMemo(
    () =>
      buildManagedMembersByBillingAccount(accounts, dashboardQuery.data?.accounts ?? []),
    [accounts, dashboardQuery.data?.accounts],
  );
  const selectedBusinessAccount = useMemo(
    () =>
      selectedBusinessAccountId === null
        ? null
        : accounts.find((account) => account.id === selectedBusinessAccountId) ?? null,
    [accounts, selectedBusinessAccountId],
  );
  const editingBusinessAccount = useMemo(
    () =>
      editingBusinessAccountId === null
        ? null
        : accounts.find((account) => account.id === editingBusinessAccountId) ?? null,
    [accounts, editingBusinessAccountId],
  );
  const deletingBusinessAccount = useMemo(
    () =>
      deletingBusinessAccountId === null
        ? null
        : accounts.find((account) => account.id === deletingBusinessAccountId) ?? null,
    [accounts, deletingBusinessAccountId],
  );
  const selectedBusinessAccountMembers = useMemo(() => {
    if (!selectedBusinessAccount) {
      return [];
    }
    return accountListMembers;
  }, [accountListMembers, selectedBusinessAccount]);
  const activeDashboardAccounts = useMemo(
    () =>
      (dashboardQuery.data?.accounts ?? []).filter(
        (account) => account.status.trim().toLowerCase() === "active",
      ),
    [dashboardQuery.data?.accounts],
  );
  const availableActiveDashboardAccounts = useMemo(() => {
    const assignedEmails = new Set(
      selectedBusinessAccountMembers.map((member) => member.email.trim().toLowerCase()),
    );
    return activeDashboardAccounts
      .filter((account) => !assignedEmails.has(account.email.trim().toLowerCase()))
      .sort((left, right) =>
        (left.displayName || left.email).localeCompare(right.displayName || right.email),
      );
  }, [activeDashboardAccounts, selectedBusinessAccountMembers]);
  const selectedBusinessAccountSeatUsage = useMemo(
    () => getSeatUsageFromMembers(selectedBusinessAccountMembers),
    [selectedBusinessAccountMembers],
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
  const totalMonthlySpendEuro = useMemo(
    () =>
      totalChatgptSeats * CHATGPT_SEAT_MONTHLY_PRICE_EUR +
      totalCodexSeats * CODEX_SEAT_MONTHLY_PRICE_EUR,
    [totalChatgptSeats, totalCodexSeats],
  );
  const notEntitledCount = accounts.length - entitledCount;
  const errorMessage = getErrorMessageOrNull(
    billingQuery.error,
    "Failed to load live billing summary.",
  );
  const editPending = updateAccountsMutation.isPending;
  const createPending = createAccountMutation.isPending;
  const deletePending = deleteAccountMutation.isPending;

  function openEditDialog(account: BillingAccount) {
    setEditingBusinessAccountId(account.id);
    setEditForm(getEditFormFromAccount(account));
    setEditFormError(null);
    setEditDialogOpen(true);
  }

  function resetEditDialog() {
    setEditDialogOpen(false);
    setEditingBusinessAccountId(null);
    setEditForm(DEFAULT_EDIT_ACCOUNT_FORM);
    setEditFormError(null);
  }

  function openDeleteDialog(account: BillingAccount) {
    setDeletingBusinessAccountId(account.id);
    setDeleteFormError(null);
    setDeleteDialogOpen(true);
  }

  function openAccountListDialog(account: BillingAccount) {
    setSelectedBusinessAccountId(account.id);
    setAccountListMembers(managedMembersByBillingAccount[account.id] ?? account.members);
    setAccountListForm(DEFAULT_ACCOUNT_LIST_FORM);
    setAccountListFormOpen(false);
    setAccountListError(null);
  }

  function resetDeleteDialog() {
    setDeleteDialogOpen(false);
    setDeletingBusinessAccountId(null);
    setDeleteFormError(null);
  }

  async function handleEditSubscriptionAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editingBusinessAccount) {
      setEditFormError("Select a subscription account to edit.");
      return;
    }

    const planName = editForm.planName.trim();
    const planCode = editForm.planCode.trim();
    if (!planName) {
      setEditFormError("Plan name is required.");
      return;
    }
    if (!planCode) {
      setEditFormError("Plan code is required.");
      return;
    }

    const chatgptSeatsInUse = Number.parseInt(editForm.chatgptSeatsInUse, 10);
    if (!Number.isInteger(chatgptSeatsInUse) || chatgptSeatsInUse < 0) {
      setEditFormError("ChatGPT seats must be a non-negative whole number.");
      return;
    }

    const codexSeatsInUse = Number.parseInt(editForm.codexSeatsInUse, 10);
    if (!Number.isInteger(codexSeatsInUse) || codexSeatsInUse < 0) {
      setEditFormError("Codex seats must be a non-negative whole number.");
      return;
    }

    let renewalAt: Date | null = null;
    if (editForm.renewalAt.trim()) {
      const parsedRenewalAt = new Date(`${editForm.renewalAt}T00:00:00.000Z`);
      if (Number.isNaN(parsedRenewalAt.getTime())) {
        setEditFormError("Renewal date must be valid.");
        return;
      }
      renewalAt = parsedRenewalAt;
    }

    setEditFormError(null);

    const updatedAccounts = accounts.map((account) =>
      account.id === editingBusinessAccount.id
        ? {
            ...account,
            planName,
            planCode,
            subscriptionStatus: editForm.subscriptionStatus,
            paymentStatus: editForm.paymentStatus,
            entitled: editForm.entitled,
            renewalAt,
            chatgptSeatsInUse,
            codexSeatsInUse,
          }
        : account,
    );

    try {
      await updateAccountsMutation.mutateAsync({ accounts: updatedAccounts });
      resetEditDialog();
    } catch (error) {
      setEditFormError(getErrorMessageOrNull(error, "Failed to update subscription account."));
    }
  }

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

  async function handleDeleteSubscriptionAccount() {
    if (!deletingBusinessAccount) {
      setDeleteFormError("Select a subscription account to delete.");
      return;
    }

    setDeleteFormError(null);

    try {
      await deleteAccountMutation.mutateAsync({ id: deletingBusinessAccount.id });
      if (selectedBusinessAccountId === deletingBusinessAccount.id) {
        setSelectedBusinessAccountId(null);
      }
      if (editingBusinessAccountId === deletingBusinessAccount.id) {
        resetEditDialog();
      }
      resetDeleteDialog();
    } catch (error) {
      setDeleteFormError(getErrorMessageOrNull(error, "Failed to delete subscription account."));
    }
  }

  function resetAccountListDialog() {
    setSelectedBusinessAccountId(null);
    setAccountListMembers([]);
    setAccountListForm(DEFAULT_ACCOUNT_LIST_FORM);
    setAccountListFormOpen(false);
    setAccountListError(null);
  }

  function handleAddAccountListMember(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const name = accountListForm.name.trim();
    const email = accountListForm.email.trim().toLowerCase();

    if (!name) {
      setAccountListError("Account name is required.");
      return;
    }

    if (!email || !email.includes("@")) {
      setAccountListError("Account email must be valid.");
      return;
    }

    if (accountListMembers.some((member) => member.email.trim().toLowerCase() === email)) {
      setAccountListError("This account email is already assigned.");
      return;
    }

    addAccountListMember({ name, email });
    setAccountListForm(DEFAULT_ACCOUNT_LIST_FORM);
    setAccountListFormOpen(false);
  }

  function addAccountListMember({ name, email }: { name: string; email: string }) {
    setAccountListMembers((current) => [
      ...current,
      {
        id: `member-manual-${email.replace(/[^a-z0-9]+/gi, "-")}`,
        name,
        email,
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: new Date().toISOString(),
      },
    ]);
    setAccountListError(null);
  }

  function handleQuickAddActiveDashboardAccount(name: string, email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !normalizedEmail.includes("@")) {
      setAccountListError("Account email must be valid.");
      return;
    }
    if (accountListMembers.some((member) => member.email.trim().toLowerCase() === normalizedEmail)) {
      setAccountListError("This account email is already assigned.");
      return;
    }
    addAccountListMember({
      name: name.trim() || normalizedEmail,
      email: normalizedEmail,
    });
  }

  function handleRemoveAccountListMember(email: string) {
    setAccountListMembers((current) =>
      current.filter((member) => member.email.trim().toLowerCase() !== email.trim().toLowerCase()),
    );
    setAccountListError(null);
  }

  async function handleSaveAccountList() {
    if (!selectedBusinessAccount) {
      setAccountListError("Select a subscription account to update.");
      return;
    }

    const updatedSeatUsage = getSeatUsageFromMembers(accountListMembers);
    const updatedAccounts = accounts.map((account) =>
      account.id === selectedBusinessAccount.id
        ? {
            ...account,
            members: accountListMembers,
            ...updatedSeatUsage,
          }
        : account,
    );

    try {
      await updateAccountsMutation.mutateAsync({ accounts: updatedAccounts });
      setAccountListError(null);
    } catch (error) {
      setAccountListError(getErrorMessageOrNull(error, "Failed to update account list."));
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
        <Card className="border-border/70">
          <CardContent className="space-y-5 py-10">
            <EmptyState
              icon={Building2}
              title="No billed accounts yet"
              description="No subscription accounts are currently stored for this dashboard."
            />
            <div className="flex justify-center">
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
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
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
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Monthly spend
              </p>
              <p className="mt-2 text-2xl font-semibold">{formatEuro(totalMonthlySpendEuro)}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {totalChatgptSeats} ChatGPT × €{CHATGPT_SEAT_MONTHLY_PRICE_EUR} · {totalCodexSeats} Codex × €
                {CODEX_SEAT_MONTHLY_PRICE_EUR}
              </p>
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
                      <TableHead className="w-[220px] text-right">Actions</TableHead>
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
                            {shouldShowPlanCode(account.planName, account.planCode) ? (
                              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                                {account.planCode}
                              </p>
                            ) : null}
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
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-full px-3"
                              aria-label={`Watch ${account.domain} accounts list`}
                              onClick={() => openAccountListDialog(account)}
                            >
                              <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              Watch
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-8 rounded-full px-3"
                              aria-label={`Edit ${account.domain} subscription account`}
                              onClick={() => openEditDialog(account)}
                            >
                              <PencilLine className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                              aria-label={`Delete ${account.domain} subscription account`}
                              onClick={() => openDeleteDialog(account)}
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          <Dialog
            open={editDialogOpen}
            onOpenChange={(open) => {
              if (!open) {
                resetEditDialog();
                return;
              }
              setEditDialogOpen(true);
            }}
          >
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>
                  {editingBusinessAccount ? `Edit ${editingBusinessAccount.domain}` : "Edit subscription account"}
                </DialogTitle>
                <DialogDescription>
                  Adjust the business account plan settings, entitlement status, and seat counts.
                </DialogDescription>
              </DialogHeader>

              {editingBusinessAccount ? (
                <form className="space-y-4" onSubmit={handleEditSubscriptionAccount}>
                  <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Business account</p>
                    <p className="mt-1 font-medium text-foreground">{editingBusinessAccount.domain}</p>
                    <p className="text-xs text-muted-foreground">{editingBusinessAccount.id}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-plan-name">Plan name</Label>
                      <Input
                        id="billing-edit-plan-name"
                        value={editForm.planName}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, planName: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-plan-code">Plan code</Label>
                      <Input
                        id="billing-edit-plan-code"
                        value={editForm.planCode}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, planCode: event.target.value }))
                        }
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-subscription-status">Subscription status</Label>
                      <Select
                        value={editForm.subscriptionStatus}
                        onValueChange={(value: BillingAccount["subscriptionStatus"]) =>
                          setEditForm((current) => ({ ...current, subscriptionStatus: value }))
                        }
                      >
                        <SelectTrigger id="billing-edit-subscription-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SUBSCRIPTION_STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {formatStatusLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-payment-status">Payment status</Label>
                      <Select
                        value={editForm.paymentStatus}
                        onValueChange={(value: BillingAccount["paymentStatus"]) =>
                          setEditForm((current) => ({ ...current, paymentStatus: value }))
                        }
                      >
                        <SelectTrigger id="billing-edit-payment-status" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PAYMENT_STATUS_OPTIONS.map((status) => (
                            <SelectItem key={status} value={status}>
                              {formatStatusLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-renewal-at">Renewal date</Label>
                      <Input
                        id="billing-edit-renewal-at"
                        type="date"
                        value={editForm.renewalAt}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, renewalAt: event.target.value }))
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-xl border border-border/70 px-4 py-3 sm:min-w-[220px]">
                      <div>
                        <p className="text-sm font-medium text-foreground">Entitled</p>
                        <p className="text-xs text-muted-foreground">
                          Premium dashboard access is enabled for this account.
                        </p>
                      </div>
                      <Switch
                        checked={editForm.entitled}
                        onCheckedChange={(checked) =>
                          setEditForm((current) => ({ ...current, entitled: checked }))
                        }
                        aria-label="Toggle entitlement"
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-chatgpt-seats">ChatGPT seats in use</Label>
                      <Input
                        id="billing-edit-chatgpt-seats"
                        type="number"
                        min={0}
                        value={editForm.chatgptSeatsInUse}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, chatgptSeatsInUse: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="billing-edit-codex-seats">Codex seats in use</Label>
                      <Input
                        id="billing-edit-codex-seats"
                        type="number"
                        min={0}
                        value={editForm.codexSeatsInUse}
                        onChange={(event) =>
                          setEditForm((current) => ({ ...current, codexSeatsInUse: event.target.value }))
                        }
                      />
                    </div>
                  </div>

                  {editFormError ? <p className="text-sm text-destructive">{editFormError}</p> : null}

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={resetEditDialog} disabled={editPending}>
                      Cancel
                    </Button>
                    <Button type="submit" disabled={editPending}>
                      {editPending ? "Saving..." : "Save changes"}
                    </Button>
                  </DialogFooter>
                </form>
              ) : null}
            </DialogContent>
          </Dialog>

          <Dialog
            open={deleteDialogOpen}
            onOpenChange={(open) => {
              if (!open) {
                resetDeleteDialog();
                return;
              }
              setDeleteDialogOpen(true);
            }}
          >
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {deletingBusinessAccount
                    ? `Delete ${deletingBusinessAccount.domain}?`
                    : "Delete subscription account"}
                </DialogTitle>
                <DialogDescription>
                  This permanently removes the business account from the subscription summary.
                </DialogDescription>
              </DialogHeader>
              {deleteFormError ? <p className="text-sm text-destructive">{deleteFormError}</p> : null}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={resetDeleteDialog} disabled={deletePending}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleDeleteSubscriptionAccount()}
                  disabled={deletePending}
                >
                  {deletePending ? "Deleting..." : "Delete account"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={selectedBusinessAccountId !== null}
            onOpenChange={(open) => {
              if (!open) {
                resetAccountListDialog();
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
                        {selectedBusinessAccountSeatUsage.chatgptSeatsInUse} ChatGPT ·{" "}
                        {selectedBusinessAccountSeatUsage.codexSeatsInUse} Codex
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">Grouped from dashboard accounts</p>
                      <p className="text-xs text-muted-foreground">
                        Accounts are matched to business billing rows by email domain. Unmatched emails stay inside
                        existing billed accounts instead of creating new billing businesses.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setAccountListFormOpen((current) => !current);
                        setAccountListError(null);
                      }}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                      Add account
                    </Button>
                  </div>

                  {accountListFormOpen ? (
                    <form
                      className="grid gap-3 rounded-xl border border-border/70 bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"
                      onSubmit={handleAddAccountListMember}
                    >
                      <div className="space-y-2">
                        <Label htmlFor="billing-account-list-name">Account name</Label>
                        <Input
                          id="billing-account-list-name"
                          value={accountListForm.name}
                          onChange={(event) =>
                            setAccountListForm((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="billing-account-list-email">Account email</Label>
                        <Input
                          id="billing-account-list-email"
                          type="email"
                          value={accountListForm.email}
                          onChange={(event) =>
                            setAccountListForm((current) => ({ ...current, email: event.target.value }))
                          }
                        />
                      </div>
                      <div className="flex items-end">
                        <Button type="submit" className="w-full md:w-auto">
                          Add member
                        </Button>
                      </div>
                      <div className="space-y-2 md:col-span-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Current active accounts
                        </p>
                        {availableActiveDashboardAccounts.length > 0 ? (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {availableActiveDashboardAccounts.map((account) => (
                              <div
                                key={account.accountId}
                                className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background/80 px-3 py-2"
                              >
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-foreground">
                                    {account.displayName || account.email}
                                  </p>
                                  <p className="truncate text-xs text-muted-foreground">{account.email}</p>
                                </div>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs"
                                  onClick={() =>
                                    handleQuickAddActiveDashboardAccount(
                                      account.displayName,
                                      account.email,
                                    )
                                  }
                                  aria-label={`Add ${account.email}`}
                                >
                                  Add
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            All active accounts are already in this billing account.
                          </p>
                        )}
                      </div>
                    </form>
                  ) : null}

                  <div className="overflow-hidden rounded-xl border border-border/70">
                    <Table>
                      <TableHeader className="bg-muted/30">
                        <TableRow>
                          <TableHead>Name</TableHead>
                          <TableHead>Role</TableHead>
                          <TableHead>Seat type</TableHead>
                          <TableHead>Date added</TableHead>
                          <TableHead className="w-[72px] text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedBusinessAccountMembers.map((member) => (
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
                            <TableCell className="text-right">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
                                aria-label={`Remove ${member.email}`}
                                onClick={() => handleRemoveAccountListMember(member.email)}
                              >
                                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                        {selectedBusinessAccountMembers.length === 0 ? (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="py-8 text-center text-sm text-muted-foreground"
                            >
                              This business account has no members.
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </TableBody>
                    </Table>
                  </div>

                  {accountListError ? <p className="text-sm text-destructive">{accountListError}</p> : null}

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={resetAccountListDialog}>
                      Close
                    </Button>
                    <Button type="button" onClick={() => void handleSaveAccountList()} disabled={editPending}>
                      {editPending ? "Saving..." : "Save account list"}
                    </Button>
                  </DialogFooter>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </>
      )}
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
    </div>
  );
}
