import type { BillingAccount, BillingMember } from "@/features/billing/schemas";
import type { AccountSummary } from "@/features/dashboard/schemas";

type SeatUsage = {
  chatgptSeatsInUse: number;
  codexSeatsInUse: number;
};

function getEmailDomain(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  const [, domain = ""] = normalized.split("@");
  return domain || null;
}

function sortMembers(members: BillingMember[]): BillingMember[] {
  return [...members].sort((left, right) => {
    if (left.role !== right.role) {
      return left.role === "Owner" ? -1 : 1;
    }

    const byName = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    if (byName !== 0) {
      return byName;
    }

    return left.email.localeCompare(right.email, undefined, { sensitivity: "base" });
  });
}

function buildFallbackMember(account: AccountSummary, nowIso: string): BillingMember {
  return {
    id: `member-live-${account.accountId}`,
    name: account.displayName?.trim() || account.email,
    email: account.email.trim().toLowerCase(),
    role: "Member",
    seatType: "ChatGPT",
    dateAdded: nowIso,
  };
}

export function getSeatUsageFromMembers(members: BillingMember[]): SeatUsage {
  return members.reduce<SeatUsage>(
    (usage, member) => {
      if (member.seatType === "Codex") {
        usage.codexSeatsInUse += 1;
      } else {
        usage.chatgptSeatsInUse += 1;
      }
      return usage;
    },
    {
      chatgptSeatsInUse: 0,
      codexSeatsInUse: 0,
    },
  );
}

export function buildManagedMembersByBillingAccount(
  billingAccounts: BillingAccount[],
  dashboardAccounts: AccountSummary[],
  nowIso: string = new Date().toISOString(),
): Record<string, BillingMember[]> {
  const targetAccountIds = billingAccounts.map((account) => account.id);
  const domainToAccountId = new Map(
    billingAccounts.map((account) => [account.domain.trim().toLowerCase(), account.id] as const),
  );
  const assignedLiveAccounts = new Map<string, AccountSummary[]>();
  let fallbackIndex = 0;

  for (const account of dashboardAccounts) {
    const email = account.email?.trim().toLowerCase();
    if (!email) {
      continue;
    }

    const matchingAccountId = domainToAccountId.get(getEmailDomain(email) ?? "");
    const fallbackAccountId =
      targetAccountIds.length > 0 ? targetAccountIds[fallbackIndex % targetAccountIds.length] : null;
    const targetAccountId = matchingAccountId ?? fallbackAccountId;

    if (!targetAccountId) {
      continue;
    }

    if (matchingAccountId === undefined) {
      fallbackIndex += 1;
    }

    const existing = assignedLiveAccounts.get(targetAccountId) ?? [];
    existing.push(account);
    assignedLiveAccounts.set(targetAccountId, existing);
  }

  return Object.fromEntries(
    billingAccounts.map((billingAccount) => {
      const existingMembersByEmail = new Map(
        billingAccount.members.map((member) => [member.email.trim().toLowerCase(), member] as const),
      );
      const usedEmails = new Set<string>();
      const mergedMembers: BillingMember[] = [];

      for (const liveAccount of assignedLiveAccounts.get(billingAccount.id) ?? []) {
        const normalizedEmail = liveAccount.email.trim().toLowerCase();
        usedEmails.add(normalizedEmail);
        mergedMembers.push(existingMembersByEmail.get(normalizedEmail) ?? buildFallbackMember(liveAccount, nowIso));
      }

      for (const member of billingAccount.members) {
        const normalizedEmail = member.email.trim().toLowerCase();
        if (usedEmails.has(normalizedEmail)) {
          continue;
        }
        mergedMembers.push(member);
      }

      return [billingAccount.id, sortMembers(mergedMembers)];
    }),
  );
}
