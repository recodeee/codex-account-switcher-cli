import type { AccountSummary } from "@/features/accounts/schemas";

export function isAccountWorkingNow(
  account: Pick<AccountSummary, "codexSessionCount" | "codexAuth">,
): boolean {
  const isActiveSnapshot = account.codexAuth?.isActiveSnapshot ?? false;
  const hasLiveSession = account.codexAuth?.hasLiveSession ?? false;
  const hasTrackedSession = (account.codexSessionCount ?? 0) > 0;
  return hasLiveSession || isActiveSnapshot || hasTrackedSession;
}

