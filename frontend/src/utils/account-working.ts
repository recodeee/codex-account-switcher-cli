import type { AccountSummary } from "@/features/accounts/schemas";

const LIVE_TELEMETRY_STALE_AFTER_MS = 5 * 60 * 1000;

function parseRecordedAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  return timestampMs;
}

function isFreshTimestamp(
  value: string | null | undefined,
  nowMs: number,
): boolean {
  const recordedAtMs = parseRecordedAtMs(value);
  if (recordedAtMs == null) return false;
  return nowMs - recordedAtMs <= LIVE_TELEMETRY_STALE_AFTER_MS;
}

export function isFreshQuotaTelemetryTimestamp(
  value: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return isFreshTimestamp(value, nowMs);
}

export function hasFreshLiveTelemetry(
  account: Pick<
    AccountSummary,
    | "codexAuth"
    | "codexLiveSessionCount"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  const liveSessionCount = Math.max(account.codexLiveSessionCount ?? 0, 0);
  if (liveSessionCount > 0) {
    return true;
  }

  if (!(account.codexAuth?.hasLiveSession ?? false)) {
    return false;
  }

  return (
    isFreshTimestamp(account.lastUsageRecordedAtPrimary, nowMs) ||
    isFreshTimestamp(account.lastUsageRecordedAtSecondary, nowMs)
  );
}

export function isAccountWorkingNow(
  account: Pick<
    AccountSummary,
    | "codexAuth"
    | "codexLiveSessionCount"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  return hasFreshLiveTelemetry(account, nowMs);
}
