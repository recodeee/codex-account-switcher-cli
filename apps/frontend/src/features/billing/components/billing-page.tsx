import { format } from "date-fns";
import { CalendarClock, Info, Plus, Users } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SeatType = "ChatGPT" | "Codex";

type BillingMember = {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Member";
  seatType: SeatType;
  dateAdded: Date;
};

const CHATGPT_MONTHLY_SEAT_PRICE_EUR = 26;
const BILLING_CYCLE_START = new Date(2026, 2, 23);
const BILLING_CYCLE_END = new Date(2026, 3, 23);

const INITIAL_MEMBERS: BillingMember[] = [
  {
    id: "member-bianka-belovics",
    name: "Bianka Belovics",
    email: "bia@edixai.com",
    role: "Member",
    seatType: "ChatGPT",
    dateAdded: new Date(2026, 2, 30),
  },
  {
    id: "member-business-webu",
    name: "business webu",
    email: "webubusiness@gmail.com",
    role: "Member",
    seatType: "ChatGPT",
    dateAdded: new Date(2026, 2, 31),
  },
  {
    id: "member-csoves",
    name: "Csoves",
    email: "csoves@edixai.com",
    role: "Member",
    seatType: "Codex",
    dateAdded: new Date(2026, 2, 23),
  },
  {
    id: "member-denver",
    name: "denver",
    email: "denver@edixai.com",
    role: "Member",
    seatType: "Codex",
    dateAdded: new Date(2026, 2, 23),
  },
  {
    id: "member-edix-ai",
    name: "Edix ai (You)",
    email: "admin@edixai.com",
    role: "Owner",
    seatType: "ChatGPT",
    dateAdded: new Date(2026, 2, 23),
  },
  {
    id: "member-nagy-viktor-csoves",
    name: "Nagy Viktor",
    email: "csoves.com@gmail.com",
    role: "Member",
    seatType: "Codex",
    dateAdded: new Date(2026, 3, 3),
  },
  {
    id: "member-nagy-viktor-alt",
    name: "Nagy Viktor",
    email: "nagyvikt007@gmail.com",
    role: "Member",
    seatType: "Codex",
    dateAdded: new Date(2026, 3, 3),
  },
  {
    id: "member-viktor",
    name: "Viktor",
    email: "thedalyscooby@gmail.com",
    role: "Member",
    seatType: "ChatGPT",
    dateAdded: new Date(2026, 3, 3),
  },
  {
    id: "member-viktor-nagy",
    name: "Viktor Nagy",
    email: "nagyviktorpd@edixai.com",
    role: "Member",
    seatType: "Codex",
    dateAdded: new Date(2026, 3, 3),
  },
  {
    id: "member-zeus",
    name: "Zeus",
    email: "zeus@edixai.com",
    role: "Member",
    seatType: "ChatGPT",
    dateAdded: new Date(2026, 3, 1),
  },
];

type NewMemberFormState = {
  name: string;
  email: string;
  seatType: SeatType;
};

const DEFAULT_NEW_MEMBER_FORM_STATE: NewMemberFormState = {
  name: "",
  email: "",
  seatType: "ChatGPT",
};

function formatDateLabel(date: Date): string {
  return format(date, "MMM d, yyyy");
}

function createBillingMemberId(name: string, email: string): string {
  const prefix = `${name.trim().toLowerCase().replace(/\s+/g, "-")}-${email
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}`
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `member-${prefix}-${crypto.randomUUID()}`;
  }

  return `member-${prefix}-${Date.now().toString(36)}`;
}

export function BillingPage() {
  const [members, setMembers] = useState<BillingMember[]>(INITIAL_MEMBERS);
  const [inviteDialogOpen, setInviteDialogOpen] = useState(false);
  const [newMember, setNewMember] = useState<NewMemberFormState>(DEFAULT_NEW_MEMBER_FORM_STATE);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const cycleLabel = useMemo(
    () => `${format(BILLING_CYCLE_START, "MMM d")} - ${format(BILLING_CYCLE_END, "MMM d")}`,
    [],
  );

  const seatCounts = useMemo(() => {
    return members.reduce(
      (accumulator, member) => {
        if (member.seatType === "ChatGPT") {
          accumulator.chatgpt += 1;
        } else {
          accumulator.codex += 1;
        }
        return accumulator;
      },
      { chatgpt: 0, codex: 0 },
    );
  }, [members]);

  const monthlyTotal = seatCounts.chatgpt * CHATGPT_MONTHLY_SEAT_PRICE_EUR;

  const handleChangeSeatType = (memberId: string, seatType: SeatType) => {
    setMembers((previous) =>
      previous.map((member) =>
        member.id === memberId
          ? {
              ...member,
              seatType,
            }
          : member,
      ),
    );
  };

  const handleInviteMember = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const trimmedName = newMember.name.trim();
    const trimmedEmail = newMember.email.trim().toLowerCase();

    if (!trimmedName) {
      setInviteError("Name is required.");
      return;
    }

    if (!trimmedEmail || !trimmedEmail.includes("@")) {
      setInviteError("A valid email is required.");
      return;
    }

    setMembers((previous) => [
      {
        id: createBillingMemberId(trimmedName, trimmedEmail),
        name: trimmedName,
        email: trimmedEmail,
        role: "Member",
        seatType: newMember.seatType,
        dateAdded: new Date(),
      },
      ...previous,
    ]);

    setInviteDialogOpen(false);
    setInviteError(null);
    setNewMember(DEFAULT_NEW_MEMBER_FORM_STATE);
  };

  return (
    <div className="animate-fade-in-up space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your business plan, assign seats, and track your monthly team cost.
        </p>
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

            <Button type="button" variant="secondary" className="rounded-full px-5">
              Switch to annual billing and save 19%
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-5 pt-6">
          <div className="rounded-xl bg-indigo-100/90 px-4 py-3 text-base font-medium text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-100">
            Up to 5 seats free for 1 month
          </div>

          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-3xl font-semibold leading-none">Codex seat</p>
                <p className="mt-1 text-lg text-muted-foreground">No fixed costs, pay as you go pricing</p>
              </div>
              <p className="text-3xl font-semibold leading-none">{seatCounts.codex} seats in use</p>
            </div>

            <Separator />

            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-3xl font-semibold leading-none">ChatGPT seat</p>
                <p className="mt-1 text-lg text-muted-foreground">
                  ChatGPT and Codex, €{CHATGPT_MONTHLY_SEAT_PRICE_EUR}/month
                </p>
              </div>
              <p className="text-3xl font-semibold leading-none">{seatCounts.chatgpt} seats in use</p>
            </div>
          </div>

          <div className="space-y-2 rounded-xl border border-border/80 bg-muted/50 px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-foreground">
                Total ChatGPT monthly cost: €{monthlyTotal}/month
              </p>
              <p className="text-xs text-muted-foreground">Renews on {format(BILLING_CYCLE_END, "MMM d")}</p>
            </div>
            <p className="text-xs text-muted-foreground">At renewal, you&apos;re billed only for assigned seats.</p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-border/70">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0 pb-4">
          <div>
            <CardTitle className="text-xl">Users and seat assignment</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Add members and set each user to ChatGPT or Codex seats.
            </p>
          </div>

          <Button type="button" onClick={() => setInviteDialogOpen(true)}>
            <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
            Invite member
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          <div className="rounded-lg border border-amber-400/30 bg-amber-50/70 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-100">
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5" aria-hidden="true" />
              Seat pricing and cycle in this view are configured from your team policy.
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Seat type</TableHead>
                <TableHead>Date added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="font-medium">{member.name}</div>
                    <div className="text-xs text-muted-foreground">{member.email}</div>
                  </TableCell>
                  <TableCell>{member.role}</TableCell>
                  <TableCell>
                    <Select
                      value={member.seatType}
                      onValueChange={(value) => handleChangeSeatType(member.id, value as SeatType)}
                    >
                      <SelectTrigger className="h-8 w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ChatGPT">ChatGPT</SelectItem>
                        <SelectItem value="Codex">Codex</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>{formatDateLabel(member.dateAdded)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <p className="text-xs text-muted-foreground">
            {seatCounts.chatgpt} ChatGPT seats × €{CHATGPT_MONTHLY_SEAT_PRICE_EUR} = €{monthlyTotal}/month · Billing cycle ends on{" "}
            {format(BILLING_CYCLE_END, "MMM d")}
          </p>
        </CardContent>
      </Card>

      <Dialog
        open={inviteDialogOpen}
        onOpenChange={(open) => {
          setInviteDialogOpen(open);
          if (!open) {
            setInviteError(null);
            setNewMember(DEFAULT_NEW_MEMBER_FORM_STATE);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite member</DialogTitle>
            <DialogDescription>
              Add a new teammate and assign their seat type for this billing cycle.
            </DialogDescription>
          </DialogHeader>

          <form className="space-y-4" onSubmit={handleInviteMember}>
            <div className="space-y-2">
              <Label htmlFor="billing-member-name">Name</Label>
              <Input
                id="billing-member-name"
                value={newMember.name}
                onChange={(event) => {
                  setNewMember((previous) => ({
                    ...previous,
                    name: event.target.value,
                  }));
                }}
                placeholder="e.g. Alex Morgan"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing-member-email">Email</Label>
              <Input
                id="billing-member-email"
                value={newMember.email}
                onChange={(event) => {
                  setNewMember((previous) => ({
                    ...previous,
                    email: event.target.value,
                  }));
                }}
                placeholder="name@company.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="billing-member-seat-type">Seat type</Label>
              <Select
                value={newMember.seatType}
                onValueChange={(value) => {
                  setNewMember((previous) => ({
                    ...previous,
                    seatType: value as SeatType,
                  }));
                }}
              >
                <SelectTrigger id="billing-member-seat-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ChatGPT">ChatGPT (€26/month)</SelectItem>
                  <SelectItem value="Codex">Codex (pay as you go)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {inviteError ? <p className="text-xs text-destructive">{inviteError}</p> : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                <Users className="mr-1 h-4 w-4" aria-hidden="true" />
                Add seat
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
