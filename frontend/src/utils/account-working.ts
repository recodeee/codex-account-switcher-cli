import type { AccountSummary } from "@/features/accounts/schemas";

export function isAccountWorkingNow(
  account: Pick<AccountSummary, "codexSessionCount" | "codexAuth">,
): boolean {
  const hasLiveSession = account.codexAuth?.hasLiveSession ?? false;
  const hasTrackedSession = (account.codexSessionCount ?? 0) > 0;
  return hasLiveSession || hasTrackedSession;
}
