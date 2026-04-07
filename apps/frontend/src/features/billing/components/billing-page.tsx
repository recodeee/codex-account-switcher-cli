import { format } from "date-fns";
import {
  Building2,
  CalendarClock,
  ChevronDown,
  Euro,
  Eye,
  MoreHorizontal,
  Sparkles,
  Users2,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type BusinessPlanAccount = {
  id: string;
  domain: string;
  chatgptSeatsInUse: number;
  codexSeatsInUse: number;
  members: BusinessPlanMember[];
};

type BusinessPlanMember = {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Member";
  seatType: "ChatGPT" | "Codex";
  dateAdded: string;
};

const CHATGPT_MONTHLY_SEAT_PRICE_EUR = 26;
const BILLING_CYCLE_START = new Date(2026, 2, 23);
const BILLING_CYCLE_END = new Date(2026, 3, 23);

const BUSINESS_PLAN_ACCOUNTS: BusinessPlanAccount[] = [
  {
    id: "business-plan-edixai",
    domain: "edixai.com",
    chatgptSeatsInUse: 5,
    codexSeatsInUse: 5,
    members: [
      {
        id: "member-bianka-belovics",
        name: "Bianka Belovics",
        email: "bia@edixai.com",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 30, 2026",
      },
      {
        id: "member-business-webu",
        name: "business webu",
        email: "webubusiness@gmail.com",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 31, 2026",
      },
      {
        id: "member-csoves",
        name: "Csoves",
        email: "csoves@edixai.com",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 23, 2026",
      },
      {
        id: "member-denver",
        name: "denver",
        email: "denver@edixai.com",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 23, 2026",
      },
      {
        id: "member-edixai-owner",
        name: "Edix.ai (You)",
        email: "admin@edixai.com",
        role: "Owner",
        seatType: "ChatGPT",
        dateAdded: "Mar 23, 2026",
      },
      {
        id: "member-nagy-viktor-csoves",
        name: "Nagy Viktor",
        email: "csoves.com@gmail.com",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-nagy-viktor-second",
        name: "Nagy Viktor",
        email: "nagyvikt007@gmail.com",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-viktor",
        name: "Viktor",
        email: "thedailyscooby@gmail.com",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-viktor-nagy",
        name: "Viktor Nagy",
        email: "nagyviktordp@edixai.com",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-zeus",
        name: "Zeus",
        email: "zeus@edixai.com",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Apr 1, 2026",
      },
    ],
  },
  {
    id: "business-plan-kozpont",
    domain: "kozpontihusbolt.hu",
    chatgptSeatsInUse: 5,
    codexSeatsInUse: 5,
    members: [
      {
        id: "member-kozpont-admin",
        name: "Kozpont Admin",
        email: "admin@kozpontihusbolt.hu",
        role: "Owner",
        seatType: "ChatGPT",
        dateAdded: "Mar 23, 2026",
      },
      {
        id: "member-kozpont-support",
        name: "Support Team",
        email: "support@kozpontihusbolt.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 24, 2026",
      },
      {
        id: "member-kozpont-ops",
        name: "Ops Coordinator",
        email: "ops@kozpontihusbolt.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 25, 2026",
      },
      {
        id: "member-kozpont-sales",
        name: "Sales Lead",
        email: "sales@kozpontihusbolt.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 28, 2026",
      },
      {
        id: "member-kozpont-finance",
        name: "Finance",
        email: "finance@kozpontihusbolt.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Mar 29, 2026",
      },
      {
        id: "member-kozpont-codex-1",
        name: "Automation 1",
        email: "codex1@kozpontihusbolt.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 26, 2026",
      },
      {
        id: "member-kozpont-codex-2",
        name: "Automation 2",
        email: "codex2@kozpontihusbolt.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 27, 2026",
      },
      {
        id: "member-kozpont-codex-3",
        name: "Automation 3",
        email: "codex3@kozpontihusbolt.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 30, 2026",
      },
      {
        id: "member-kozpont-codex-4",
        name: "Automation 4",
        email: "codex4@kozpontihusbolt.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Mar 31, 2026",
      },
      {
        id: "member-kozpont-codex-5",
        name: "Automation 5",
        email: "codex5@kozpontihusbolt.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 1, 2026",
      },
    ],
  },
];

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

export function BillingPage() {
  const [businessPlanDetailsOpen, setBusinessPlanDetailsOpen] = useState(false);
  const [selectedBusinessAccount, setSelectedBusinessAccount] = useState<BusinessPlanAccount | null>(
    null,
  );

  const cycleLabel = useMemo(
    () => `${format(BILLING_CYCLE_START, "MMM d")} - ${format(BILLING_CYCLE_END, "MMM d")}`,
    [],
  );

  const businessPlanTotals = useMemo(
    () =>
      BUSINESS_PLAN_ACCOUNTS.reduce(
        (accumulator, account) => ({
          chatgptSeatsInUse: accumulator.chatgptSeatsInUse + account.chatgptSeatsInUse,
          codexSeatsInUse: accumulator.codexSeatsInUse + account.codexSeatsInUse,
        }),
        { chatgptSeatsInUse: 0, codexSeatsInUse: 0 },
      ),
    [],
  );

  const businessPlanTotalMonthlyCost = useMemo(
    () =>
      BUSINESS_PLAN_ACCOUNTS.reduce(
        (accumulator, account) =>
          accumulator + account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR,
        0,
      ),
    [],
  );

  return (
    <div className="animate-fade-in-up space-y-6">
      <div className="rounded-2xl border border-border/70 bg-gradient-to-b from-card via-card to-card/70 p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-muted/50 px-3 py-1 text-xs text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Business Billing
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">Billing</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View all business accounts in your plan and track combined monthly seat costs.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-full px-5"
              onClick={() => setBusinessPlanDetailsOpen(true)}
            >
              Business plan details
            </Button>
            <Button type="button" variant="secondary" className="rounded-full px-5">
              Switch to annual billing and save 19%
            </Button>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden border-border/70">
        <CardHeader className="space-y-4 bg-card/70 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-3xl">Business Plan</CardTitle>
                <Badge className="bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/15">Monthly</Badge>
              </div>
              <p className="mt-2 flex items-center gap-2 text-base text-muted-foreground">
                <CalendarClock className="h-4 w-4" aria-hidden="true" />
                Current cycle: {cycleLabel}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Business accounts</p>
              <p className="mt-2 text-2xl font-semibold">{BUSINESS_PLAN_ACCOUNTS.length}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">ChatGPT seats in use</p>
              <p className="mt-2 text-2xl font-semibold">{businessPlanTotals.chatgptSeatsInUse}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Codex seats in use</p>
              <p className="mt-2 text-2xl font-semibold">{businessPlanTotals.codexSeatsInUse}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Monthly ChatGPT cost</p>
              <p className="mt-2 text-2xl font-semibold">€{businessPlanTotalMonthlyCost}</p>
            </div>
          </div>

          <div className="rounded-xl bg-indigo-100/90 px-4 py-3 text-base font-medium text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-100">
            Up to 5 seats free for 1 month
          </div>

          <div className="overflow-hidden rounded-xl border border-border/70">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Business account</TableHead>
                  <TableHead>ChatGPT seats</TableHead>
                  <TableHead>Codex seats</TableHead>
                  <TableHead>Monthly ChatGPT cost</TableHead>
                  <TableHead className="w-[130px] text-right">Accounts list</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {BUSINESS_PLAN_ACCOUNTS.map((account) => {
                  const accountMonthlyCost = account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR;
                  return (
                    <TableRow key={account.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-xs font-semibold uppercase text-muted-foreground">
                            {account.domain.slice(0, 1)}
                          </div>
                          <div className="font-medium">{account.domain}</div>
                        </div>
                      </TableCell>
                      <TableCell>{account.chatgptSeatsInUse} seats in use</TableCell>
                      <TableCell>{account.codexSeatsInUse} seats in use</TableCell>
                      <TableCell>€{accountMonthlyCost}/month</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 rounded-full px-3"
                          aria-label={`Watch ${account.domain} accounts list`}
                          onClick={() => setSelectedBusinessAccount(account)}
                        >
                          <Eye className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                          Watch
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <p className="text-sm text-muted-foreground">
            Total business plan monthly cost: €{businessPlanTotalMonthlyCost}/month · Renews on{" "}
            {format(BILLING_CYCLE_END, "MMM d")}
          </p>
        </CardContent>
      </Card>

      <Dialog open={businessPlanDetailsOpen} onOpenChange={setBusinessPlanDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Business plan details</DialogTitle>
            <DialogDescription>
              Full multi-account overview with total active seats and monthly business-plan totals.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <Building2 className="h-3.5 w-3.5" />
                Accounts
              </p>
              <p className="mt-1.5 text-xl font-semibold">{BUSINESS_PLAN_ACCOUNTS.length}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <Euro className="h-3.5 w-3.5" />
                Monthly total
              </p>
              <p className="mt-1.5 text-xl font-semibold">€{businessPlanTotalMonthlyCost}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <Users2 className="h-3.5 w-3.5" />
                ChatGPT seats
              </p>
              <p className="mt-1.5 text-xl font-semibold">{businessPlanTotals.chatgptSeatsInUse}</p>
            </div>
            <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
              <p className="flex items-center gap-1.5 text-xs uppercase tracking-wide text-muted-foreground">
                <Users2 className="h-3.5 w-3.5" />
                Codex seats
              </p>
              <p className="mt-1.5 text-xl font-semibold">{businessPlanTotals.codexSeatsInUse}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="overflow-hidden rounded-xl border border-border/70">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead>Business account</TableHead>
                    <TableHead>ChatGPT seats</TableHead>
                    <TableHead>Codex seats</TableHead>
                    <TableHead>Monthly ChatGPT cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {BUSINESS_PLAN_ACCOUNTS.map((account) => {
                    const accountMonthlyCost =
                      account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR;
                    return (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.domain}</TableCell>
                        <TableCell>{account.chatgptSeatsInUse} seats in use</TableCell>
                        <TableCell>{account.codexSeatsInUse} seats in use</TableCell>
                        <TableCell>€{accountMonthlyCost}/month</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2 rounded-xl border border-border/80 bg-muted/50 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">
                  Total business plan monthly cost: €{businessPlanTotalMonthlyCost}/month
                </p>
                <p className="text-xs text-muted-foreground">Renews on {format(BILLING_CYCLE_END, "MMM d")}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                Combined seats in use: {businessPlanTotals.chatgptSeatsInUse} ChatGPT and{" "}
                {businessPlanTotals.codexSeatsInUse} Codex.
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedBusinessAccount !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedBusinessAccount(null);
          }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] 2xl:max-w-[1400px]">
          <DialogHeader>
            <DialogTitle>{selectedBusinessAccount?.domain} · Accounts list</DialogTitle>
            <DialogDescription>
              Check and edit seat assignments for members in this business account.
            </DialogDescription>
          </DialogHeader>

          <div className="overflow-hidden rounded-xl border border-border/70">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Seat type</TableHead>
                  <TableHead>Date added</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedBusinessAccount?.members.map((member) => (
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
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-base">
                        {member.role}
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1 text-base">
                        {member.seatType}
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                      </span>
                    </TableCell>
                    <TableCell>{member.dateAdded}</TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={`Open actions for ${member.name}`}
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
