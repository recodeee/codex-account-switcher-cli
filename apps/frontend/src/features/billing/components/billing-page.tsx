import { format } from "date-fns";
import { Building2, CalendarClock, Euro, Sparkles, Users2 } from "lucide-react";
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
  },
  {
    id: "business-plan-kozpont",
    domain: "kozpontihusbolt.hu",
    chatgptSeatsInUse: 5,
    codexSeatsInUse: 5,
  },
];

export function BillingPage() {
  const [businessPlanDetailsOpen, setBusinessPlanDetailsOpen] = useState(false);

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
    </div>
  );
}
