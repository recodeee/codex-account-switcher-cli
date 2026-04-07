import { format } from "date-fns";
import {
  Building2,
  CalendarDays,
  CalendarClock,
  Euro,
  Eye,
  Minus,
  MoreHorizontal,
  Plus,
  Sparkles,
  Users2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { getBillingAccounts, updateBillingAccounts } from "@/features/billing/api";
import type { BillingAccount as BusinessPlanAccount, BillingMember as BusinessPlanMember } from "@/features/billing/schemas";
import { getErrorMessageOrNull } from "@/utils/errors";

const CHATGPT_MONTHLY_SEAT_PRICE_EUR = 26;
const CODEX_MONTHLY_SEAT_PRICE_EUR = 0;

const BUSINESS_PLAN_ACCOUNTS: BusinessPlanAccount[] = [
  {
    id: "business-plan-edixai",
    domain: "edixai.com",
    billingCycle: {
      start: new Date(2026, 2, 23),
      end: new Date(2026, 3, 23),
    },
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
    billingCycle: {
      start: new Date(2026, 2, 26),
      end: new Date(2026, 3, 26),
    },
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
  {
    id: "business-plan-kronakert",
    domain: "kronakert.hu",
    billingCycle: {
      start: new Date(2026, 3, 1),
      end: new Date(2026, 4, 1),
    },
    chatgptSeatsInUse: 3,
    codexSeatsInUse: 3,
    members: [
      {
        id: "member-kronakert-owner",
        name: "Kronakert Owner",
        email: "owner@kronakert.hu",
        role: "Owner",
        seatType: "ChatGPT",
        dateAdded: "Apr 1, 2026",
      },
      {
        id: "member-kronakert-admin",
        name: "Admin Team",
        email: "admin@kronakert.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Apr 2, 2026",
      },
      {
        id: "member-kronakert-sales",
        name: "Sales Ops",
        email: "sales@kronakert.hu",
        role: "Member",
        seatType: "ChatGPT",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-kronakert-codex-1",
        name: "Automation Runner 1",
        email: "codex1@kronakert.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 3, 2026",
      },
      {
        id: "member-kronakert-codex-2",
        name: "Automation Runner 2",
        email: "codex2@kronakert.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 4, 2026",
      },
      {
        id: "member-kronakert-codex-3",
        name: "Automation Runner 3",
        email: "codex3@kronakert.hu",
        role: "Member",
        seatType: "Codex",
        dateAdded: "Apr 4, 2026",
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

function formatSeatPriceLabel(seatType: BusinessPlanMember["seatType"]): string {
  const monthlySeatPrice =
    seatType === "ChatGPT" ? CHATGPT_MONTHLY_SEAT_PRICE_EUR : CODEX_MONTHLY_SEAT_PRICE_EUR;
  return `${monthlySeatPrice} euro`;
}

function formatBillingCycleLabel(cycle: BusinessPlanAccount["billingCycle"]): string {
  return `${format(cycle.start, "MMM d")} - ${format(cycle.end, "MMM d")}`;
}

function clampSeatCount(value: number): number {
  return Math.max(0, value);
}

function formatDateInputValue(value: Date): string {
  return format(value, "yyyy-MM-dd");
}

function parseDateInputValue(value: string): Date | null {
  const [year, month, day] = value.split("-").map((segment) => Number(segment));
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function BillingCycleDatePicker({
  value,
  ariaLabel,
  onSelect,
}: {
  value: Date;
  ariaLabel: string;
  onSelect: (nextValue: Date) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-[128px] justify-start px-2 text-xs tabular-nums"
          aria-label={ariaLabel}
        >
          <CalendarDays className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
          {format(value, "MMM d, yyyy")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2" align="start">
        <Input
          type="date"
          className="mb-2 h-8 text-xs tabular-nums"
          value={formatDateInputValue(value)}
          aria-label={`${ariaLabel} input`}
          onChange={(event) => {
            const parsedValue = parseDateInputValue(event.target.value);
            if (!parsedValue) {
              return;
            }
            onSelect(parsedValue);
            setOpen(false);
          }}
        />
        <Calendar
          mode="single"
          selected={value}
          onSelect={(nextValue) => {
            if (!nextValue) {
              return;
            }
            onSelect(new Date(nextValue.getFullYear(), nextValue.getMonth(), nextValue.getDate()));
            setOpen(false);
          }}
          autoFocus
        />
      </PopoverContent>
    </Popover>
  );
}

export function BillingPage() {
  const [businessPlanAccounts, setBusinessPlanAccounts] = useState(BUSINESS_PLAN_ACCOUNTS);
  const [businessPlanDetailsOpen, setBusinessPlanDetailsOpen] = useState(false);
  const [selectedBusinessAccountId, setSelectedBusinessAccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [pulsedSeatControlKey, setPulsedSeatControlKey] = useState<string | null>(null);
  const persistRequestIdRef = useRef(0);
  const seatControlPulseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;

    void getBillingAccounts()
      .then((response) => {
        if (!isMounted) {
          return;
        }
        setBusinessPlanAccounts(response.accounts);
      })
      .catch((caught) => {
        if (!isMounted) {
          return;
        }
        toast.error(getErrorMessageOrNull(caught) ?? "Failed to load billing data");
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (seatControlPulseTimeoutRef.current !== null) {
        clearTimeout(seatControlPulseTimeoutRef.current);
      }
    };
  }, []);

  function pulseSeatControl(controlKey: string) {
    setPulsedSeatControlKey(controlKey);
    if (seatControlPulseTimeoutRef.current !== null) {
      clearTimeout(seatControlPulseTimeoutRef.current);
    }
    seatControlPulseTimeoutRef.current = setTimeout(() => {
      setPulsedSeatControlKey((currentValue) => (currentValue === controlKey ? null : currentValue));
    }, 180);
  }

  function persistBusinessPlanAccounts(nextAccounts: BusinessPlanAccount[]) {
    const requestId = ++persistRequestIdRef.current;
    setIsSaving(true);

    void updateBillingAccounts({ accounts: nextAccounts })
      .then((response) => {
        if (requestId !== persistRequestIdRef.current) {
          return;
        }
        setBusinessPlanAccounts(response.accounts);
      })
      .catch((caught) => {
        if (requestId !== persistRequestIdRef.current) {
          return;
        }
        toast.error(getErrorMessageOrNull(caught) ?? "Failed to save billing changes");
      })
      .finally(() => {
        if (requestId === persistRequestIdRef.current) {
          setIsSaving(false);
        }
      });
  }

  const selectedBusinessAccount = useMemo(
    () =>
      selectedBusinessAccountId === null
        ? null
        : businessPlanAccounts.find((account) => account.id === selectedBusinessAccountId) ?? null,
    [businessPlanAccounts, selectedBusinessAccountId],
  );

  const hasMixedBillingCycles = useMemo(() => {
    const cycleFingerprints = new Set(
      businessPlanAccounts.map((account) =>
        `${account.billingCycle.start.toISOString()}::${account.billingCycle.end.toISOString()}`,
      ),
    );
    return cycleFingerprints.size > 1;
  }, [businessPlanAccounts]);

  const billingCycleHeadlineLabel = useMemo(() => {
    if (businessPlanAccounts.length === 0) {
      return "Current cycle: —";
    }
    if (hasMixedBillingCycles) {
      return "Current cycles vary by business account";
    }
    return `Current cycle: ${formatBillingCycleLabel(businessPlanAccounts[0].billingCycle)}`;
  }, [businessPlanAccounts, hasMixedBillingCycles]);

  const businessPlanTotals = useMemo(
    () =>
      businessPlanAccounts.reduce(
        (accumulator, account) => ({
          chatgptSeatsInUse: accumulator.chatgptSeatsInUse + account.chatgptSeatsInUse,
          codexSeatsInUse: accumulator.codexSeatsInUse + account.codexSeatsInUse,
        }),
        { chatgptSeatsInUse: 0, codexSeatsInUse: 0 },
      ),
    [businessPlanAccounts],
  );

  const businessPlanTotalMonthlyCost = useMemo(
    () =>
      businessPlanAccounts.reduce(
        (accumulator, account) =>
          accumulator + account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR,
        0,
      ),
    [businessPlanAccounts],
  );

  const renewalsSummaryLabel = useMemo(() => {
    if (businessPlanAccounts.length === 0) {
      return "Renews on —";
    }
    if (hasMixedBillingCycles) {
      return "Renewals vary by account";
    }
    return `Renews on ${format(businessPlanAccounts[0].billingCycle.end, "MMM d")}`;
  }, [businessPlanAccounts, hasMixedBillingCycles]);

  function updateMemberSeatType(
    accountId: string,
    memberId: string,
    nextSeatType: BusinessPlanMember["seatType"],
  ) {
    setBusinessPlanAccounts((previousAccounts) =>
      {
        let changed = false;
        const nextAccounts = previousAccounts.map((account) => {
        if (account.id !== accountId) {
          return account;
        }

        const currentMember = account.members.find((member) => member.id === memberId);
        if (!currentMember) {
          return account;
        }
        if (currentMember.seatType === nextSeatType) {
          return account;
        }
        changed = true;

        const members = account.members.map((member) =>
          member.id === memberId ? { ...member, seatType: nextSeatType } : member,
        );

        const nextChatgptSeatsInUse = clampSeatCount(
          account.chatgptSeatsInUse +
            (nextSeatType === "ChatGPT" ? 1 : 0) -
            (currentMember.seatType === "ChatGPT" ? 1 : 0),
        );
        const nextCodexSeatsInUse = clampSeatCount(
          account.codexSeatsInUse +
            (nextSeatType === "Codex" ? 1 : 0) -
            (currentMember.seatType === "Codex" ? 1 : 0),
        );

        return {
          ...account,
          members,
          chatgptSeatsInUse: nextChatgptSeatsInUse,
          codexSeatsInUse: nextCodexSeatsInUse,
        };
        });

        if (changed) {
          persistBusinessPlanAccounts(nextAccounts);
          return nextAccounts;
        }
        return previousAccounts;
      },
    );
  }

  function removeMemberAccount(accountId: string, memberId: string) {
    setBusinessPlanAccounts((previousAccounts) =>
      {
        let changed = false;
        const nextAccounts = previousAccounts.map((account) => {
        if (account.id !== accountId) {
          return account;
        }

        const removedMember = account.members.find((member) => member.id === memberId);
        if (!removedMember) {
          return account;
        }
        changed = true;

        const members = account.members.filter((member) => member.id !== memberId);
        return {
          ...account,
          members,
          chatgptSeatsInUse: clampSeatCount(
            account.chatgptSeatsInUse - (removedMember.seatType === "ChatGPT" ? 1 : 0),
          ),
          codexSeatsInUse: clampSeatCount(
            account.codexSeatsInUse - (removedMember.seatType === "Codex" ? 1 : 0),
          ),
        };
        });
        if (changed) {
          persistBusinessPlanAccounts(nextAccounts);
          return nextAccounts;
        }
        return previousAccounts;
      },
    );
  }

  function adjustSeatsInUse(
    accountId: string,
    seatType: BusinessPlanMember["seatType"],
    delta: number,
  ) {
    setBusinessPlanAccounts((previousAccounts) =>
      {
        let changed = false;
        const nextAccounts = previousAccounts.map((account) => {
        if (account.id !== accountId) {
          return account;
        }
        changed = true;

        return {
          ...account,
          chatgptSeatsInUse:
            seatType === "ChatGPT"
              ? clampSeatCount(account.chatgptSeatsInUse + delta)
              : account.chatgptSeatsInUse,
          codexSeatsInUse:
            seatType === "Codex"
              ? clampSeatCount(account.codexSeatsInUse + delta)
              : account.codexSeatsInUse,
        };
        });
        if (changed) {
          persistBusinessPlanAccounts(nextAccounts);
          return nextAccounts;
        }
        return previousAccounts;
      },
    );
    pulseSeatControl(`${accountId}:${seatType}`);
  }

  function updateBillingCycleBoundary(
    accountId: string,
    boundary: keyof BusinessPlanAccount["billingCycle"],
    nextValue: Date,
  ) {
    setBusinessPlanAccounts((previousAccounts) => {
      const normalizedDate = new Date(
        nextValue.getFullYear(),
        nextValue.getMonth(),
        nextValue.getDate(),
      );

      let changed = false;
      const nextAccounts = previousAccounts.map((account) => {
        if (account.id !== accountId) {
          return account;
        }

        const nextStart =
          boundary === "start" ? normalizedDate : new Date(account.billingCycle.start.getTime());
        const nextEnd =
          boundary === "end" ? normalizedDate : new Date(account.billingCycle.end.getTime());

        if (nextStart.getTime() > nextEnd.getTime()) {
          if (boundary === "start") {
            nextEnd.setTime(nextStart.getTime());
          } else {
            nextStart.setTime(nextEnd.getTime());
          }
        }

        if (
          nextStart.getTime() === account.billingCycle.start.getTime() &&
          nextEnd.getTime() === account.billingCycle.end.getTime()
        ) {
          return account;
        }

        changed = true;
        return {
          ...account,
          billingCycle: {
            start: nextStart,
            end: nextEnd,
          },
        };
      });

      if (changed) {
        persistBusinessPlanAccounts(nextAccounts);
        return nextAccounts;
      }

      return previousAccounts;
    });
  }

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
                {billingCycleHeadlineLabel}
              </p>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-border/70 bg-muted/30 p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Business accounts</p>
              <p className="mt-2 text-2xl font-semibold">{businessPlanAccounts.length}</p>
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
                  <TableHead>Current cycle</TableHead>
                  <TableHead>Monthly ChatGPT cost</TableHead>
                  <TableHead className="w-[130px] text-right">Accounts list</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {businessPlanAccounts.map((account) => {
                  const accountMonthlyCost = account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR;
                  const chatgptSeatControlKey = `${account.id}:ChatGPT`;
                  const codexSeatControlKey = `${account.id}:Codex`;
                  const isChatgptSeatControlPulsing = pulsedSeatControlKey === chatgptSeatControlKey;
                  const isCodexSeatControlPulsing = pulsedSeatControlKey === codexSeatControlKey;
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
                      <TableCell>
                        <div
                          role="group"
                          aria-label={`ChatGPT seats for ${account.domain}`}
                          className="inline-flex select-none items-center gap-1 rounded-md border border-border/70 bg-muted/40 p-0.5 shadow-sm"
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 cursor-pointer rounded-md transition-transform duration-150 ease-out hover:scale-105 active:scale-90 active:bg-accent/70 disabled:cursor-not-allowed disabled:scale-100"
                            aria-label={`Decrease ChatGPT seats for ${account.domain}`}
                            disabled={account.chatgptSeatsInUse <= 0}
                            onClick={() => adjustSeatsInUse(account.id, "ChatGPT", -1)}
                          >
                            <Minus className="h-3 w-3" aria-hidden="true" />
                          </Button>
                          <span
                            className={`min-w-6 text-center text-sm font-medium tabular-nums transition-transform duration-150 ease-out ${isChatgptSeatControlPulsing ? "scale-110" : "scale-100"}`}
                          >
                            {account.chatgptSeatsInUse}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 cursor-pointer rounded-md transition-transform duration-150 ease-out hover:scale-105 active:scale-90 active:bg-accent/70 disabled:cursor-not-allowed disabled:scale-100"
                            aria-label={`Increase ChatGPT seats for ${account.domain}`}
                            onClick={() => adjustSeatsInUse(account.id, "ChatGPT", 1)}
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div
                          role="group"
                          aria-label={`Codex seats for ${account.domain}`}
                          className="inline-flex select-none items-center gap-1 rounded-md border border-border/70 bg-muted/40 p-0.5 shadow-sm"
                        >
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 cursor-pointer rounded-md transition-transform duration-150 ease-out hover:scale-105 active:scale-90 active:bg-accent/70 disabled:cursor-not-allowed disabled:scale-100"
                            aria-label={`Decrease Codex seats for ${account.domain}`}
                            disabled={account.codexSeatsInUse <= 0}
                            onClick={() => adjustSeatsInUse(account.id, "Codex", -1)}
                          >
                            <Minus className="h-3 w-3" aria-hidden="true" />
                          </Button>
                          <span
                            className={`min-w-6 text-center text-sm font-medium tabular-nums transition-transform duration-150 ease-out ${isCodexSeatControlPulsing ? "scale-110" : "scale-100"}`}
                          >
                            {account.codexSeatsInUse}
                          </span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="h-7 w-7 cursor-pointer rounded-md transition-transform duration-150 ease-out hover:scale-105 active:scale-90 active:bg-accent/70 disabled:cursor-not-allowed disabled:scale-100"
                            aria-label={`Increase Codex seats for ${account.domain}`}
                            onClick={() => adjustSeatsInUse(account.id, "Codex", 1)}
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <BillingCycleDatePicker
                            value={account.billingCycle.start}
                            ariaLabel={`Billing cycle start for ${account.domain}`}
                            onSelect={(nextValue) =>
                              updateBillingCycleBoundary(account.id, "start", nextValue)
                            }
                          />
                          <span className="text-xs text-muted-foreground">→</span>
                          <BillingCycleDatePicker
                            value={account.billingCycle.end}
                            ariaLabel={`Billing cycle end for ${account.domain}`}
                            onSelect={(nextValue) =>
                              updateBillingCycleBoundary(account.id, "end", nextValue)
                            }
                          />
                        </div>
                      </TableCell>
                      <TableCell>€{accountMonthlyCost}/month</TableCell>
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
                  );
                })}
              </TableBody>
            </Table>
          </div>

          <Separator />

          <p className="text-sm text-muted-foreground">
            Total business plan monthly cost: €{businessPlanTotalMonthlyCost}/month · {renewalsSummaryLabel}
          </p>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading billing data…"
              : isSaving
                ? "Saving billing changes…"
                : "Billing changes are synced to backend."}
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
              <p className="mt-1.5 text-xl font-semibold">{businessPlanAccounts.length}</p>
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
                    <TableHead>Current cycle</TableHead>
                    <TableHead>Monthly ChatGPT cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {businessPlanAccounts.map((account) => {
                    const accountMonthlyCost =
                      account.chatgptSeatsInUse * CHATGPT_MONTHLY_SEAT_PRICE_EUR;
                    return (
                      <TableRow key={account.id}>
                        <TableCell className="font-medium">{account.domain}</TableCell>
                        <TableCell>{account.chatgptSeatsInUse} seats in use</TableCell>
                        <TableCell>{account.codexSeatsInUse} seats in use</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <BillingCycleDatePicker
                              value={account.billingCycle.start}
                              ariaLabel={`Billing cycle start for ${account.domain} in details`}
                              onSelect={(nextValue) =>
                                updateBillingCycleBoundary(account.id, "start", nextValue)
                              }
                            />
                            <span className="text-xs text-muted-foreground">→</span>
                            <BillingCycleDatePicker
                              value={account.billingCycle.end}
                              ariaLabel={`Billing cycle end for ${account.domain} in details`}
                              onSelect={(nextValue) =>
                                updateBillingCycleBoundary(account.id, "end", nextValue)
                              }
                            />
                          </div>
                        </TableCell>
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
                <p className="text-xs text-muted-foreground">{renewalsSummaryLabel}</p>
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
        open={selectedBusinessAccountId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedBusinessAccountId(null);
          }
        }}
      >
        <DialogContent className="w-[96vw] max-w-[96vw] sm:max-w-[96vw] 2xl:max-w-[1400px]">
          <DialogHeader>
            <DialogTitle>{selectedBusinessAccount?.domain} · Accounts list</DialogTitle>
            <DialogDescription>
              Check and edit seat assignments for members in this business account. Current cycle:{" "}
              {selectedBusinessAccount
                ? formatBillingCycleLabel(selectedBusinessAccount.billingCycle)
                : "—"}
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
                {selectedBusinessAccount
                  ? selectedBusinessAccount.members.map((member) => (
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
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Select
                              value={member.seatType}
                              onValueChange={(nextSeatType) =>
                                updateMemberSeatType(
                                  selectedBusinessAccount.id,
                                  member.id,
                                  nextSeatType === "Codex" ? "Codex" : "ChatGPT",
                                )
                              }
                            >
                              <SelectTrigger
                                size="sm"
                                className="h-8 w-[140px]"
                                aria-label={`Seat type for ${member.name}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ChatGPT">ChatGPT</SelectItem>
                                <SelectItem value="Codex">Codex</SelectItem>
                              </SelectContent>
                            </Select>
                            <span className="whitespace-nowrap text-xs text-muted-foreground">
                              {formatSeatPriceLabel(member.seatType)}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{member.dateAdded}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="h-8 w-8 text-muted-foreground"
                                aria-label={`Open actions for ${member.name}`}
                              >
                                <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                              <DropdownMenuLabel>{member.name}</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onSelect={() =>
                                  updateMemberSeatType(
                                    selectedBusinessAccount.id,
                                    member.id,
                                    member.seatType === "Codex" ? "ChatGPT" : "Codex",
                                  )
                                }
                              >
                                Change seat type to {member.seatType === "Codex" ? "ChatGPT" : "Codex"}
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => removeMemberAccount(selectedBusinessAccount.id, member.id)}
                              >
                                Remove account
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  : null}
                {selectedBusinessAccount && selectedBusinessAccount.members.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      This business account has no members.
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
