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

export function getFreshDebugRawSampleCount(
  account: Pick<AccountSummary, "liveQuotaDebug">,
  nowMs: number = Date.now(),
): number {
  const rawSamples = account.liveQuotaDebug?.rawSamples ?? [];
  if (rawSamples.length === 0) {
    return 0;
  }

  return rawSamples.filter((sample) => {
    if (sample.stale === true) {
      return false;
    }
    const recordedAtMs = parseRecordedAtMs(sample.recordedAt);
    if (recordedAtMs == null) {
      return true;
    }
    return nowMs - recordedAtMs <= LIVE_TELEMETRY_STALE_AFTER_MS;
  }).length;
}

export function getMergedQuotaRemainingPercent(
  account: Pick<AccountSummary, "liveQuotaDebug">,
  windowKey: "primary" | "secondary",
): number | null {
  const liveQuotaDebug = account.liveQuotaDebug;
  const merged = liveQuotaDebug?.merged;
  if (!merged || merged.stale === true) {
    return null;
  }

  const overrideReason = (liveQuotaDebug?.overrideReason ?? "").trim();
  const deferredMixedDefaultSessions =
    overrideReason.startsWith("deferred_active_snapshot_mixed_default_sessions");
  if (deferredMixedDefaultSessions && liveQuotaDebug?.overrideApplied !== true) {
    return null;
  }

  const candidate =
    windowKey === "primary"
      ? merged.primary?.remainingPercent
      : merged.secondary?.remainingPercent;

  if (typeof candidate !== "number" || Number.isNaN(candidate)) {
    return null;
  }

  return candidate;
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

  if (getFreshDebugRawSampleCount(account, nowMs) > 0) {
    return true;
  }

  return Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0;
}
