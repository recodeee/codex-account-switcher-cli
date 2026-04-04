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

function hasFreshDebugRawSamples(
  account: Pick<AccountSummary, "liveQuotaDebug">,
  nowMs: number,
): boolean {
  const rawSamples = account.liveQuotaDebug?.rawSamples ?? [];
  if (rawSamples.length === 0) {
    return false;
  }

  return rawSamples.some((sample) => {
    if (sample.stale === true) {
      return false;
    }
    const recordedAtMs = parseRecordedAtMs(sample.recordedAt);
    if (recordedAtMs == null) {
      return true;
    }
    return nowMs - recordedAtMs <= LIVE_TELEMETRY_STALE_AFTER_MS;
  });
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
    | "liveQuotaDebug"
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
    | "codexSessionCount"
    | "codexTrackedSessionCount"
    | "liveQuotaDebug"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  if (hasFreshLiveTelemetry(account, nowMs)) {
    return true;
  }

  if (hasFreshDebugRawSamples(account, nowMs)) {
    return true;
  }

  return Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0;
}
