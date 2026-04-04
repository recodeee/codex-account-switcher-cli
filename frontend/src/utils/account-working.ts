import type { AccountSummary } from "@/features/accounts/schemas";

const LIVE_TELEMETRY_STALE_AFTER_MS = 5 * 60 * 1000;

function parseRecordedAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  return timestampMs;
}

function normalizeSnapshotName(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : null;
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

type RawQuotaWindowFallback = {
  remainingPercent: number;
  resetAt: string | null;
  windowMinutes: number | null;
  recordedAt: string;
};

function toIsoFromEpochSeconds(value: number | null | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return new Date(value * 1000).toISOString();
}

function canUseRawQuotaFallback(reason: string): boolean {
  return (
    reason === "live_session_without_windows" ||
    reason === "missing_live_usage_payload" ||
    reason.startsWith("deferred_active_snapshot_mixed_default_sessions")
  );
}

export function getRawQuotaWindowFallback(
  account: Pick<AccountSummary, "liveQuotaDebug" | "codexAuth">,
  windowKey: "primary" | "secondary",
): RawQuotaWindowFallback | null {
  const liveQuotaDebug = account.liveQuotaDebug;
  if (!liveQuotaDebug) {
    return null;
  }

  const overrideReason = (liveQuotaDebug.overrideReason ?? "").trim().toLowerCase();
  if (liveQuotaDebug.overrideApplied !== true && !canUseRawQuotaFallback(overrideReason)) {
    return null;
  }

  const targetSnapshot = normalizeSnapshotName(account.codexAuth?.snapshotName);
  const consideredSnapshots = (liveQuotaDebug.snapshotsConsidered ?? [])
    .map((value) => normalizeSnapshotName(value))
    .filter((value): value is string => value != null);

  const candidates = liveQuotaDebug.rawSamples
    .filter((sample) => {
      if (sample.stale === true) {
        return false;
      }
      const window = windowKey === "primary" ? sample.primary : sample.secondary;
      return window != null && typeof window.remainingPercent === "number";
    })
    .sort((left, right) => {
      const leftMs = parseRecordedAtMs(left.recordedAt) ?? 0;
      const rightMs = parseRecordedAtMs(right.recordedAt) ?? 0;
      return rightMs - leftMs;
    });

  if (candidates.length === 0) {
    return null;
  }

  let scoped = candidates;

  if (targetSnapshot) {
    const exactSnapshotMatch = candidates.filter(
      (sample) => normalizeSnapshotName(sample.snapshotName) === targetSnapshot,
    );
    if (exactSnapshotMatch.length > 0) {
      scoped = exactSnapshotMatch;
    } else {
      const unnamedSamples = candidates.filter(
        (sample) => normalizeSnapshotName(sample.snapshotName) == null,
      );
      const consideredOnlyTarget =
        consideredSnapshots.length === 0 ||
        consideredSnapshots.every((snapshot) => snapshot === targetSnapshot);
      if (!consideredOnlyTarget || unnamedSamples.length === 0) {
        return null;
      }
      scoped = unnamedSamples;
    }
  } else if (consideredSnapshots.length > 1) {
    return null;
  }

  const selectedSample = scoped[0];
  const selectedWindow = windowKey === "primary" ? selectedSample.primary : selectedSample.secondary;
  if (!selectedWindow || typeof selectedWindow.remainingPercent !== "number") {
    return null;
  }

  return {
    remainingPercent: selectedWindow.remainingPercent,
    resetAt: toIsoFromEpochSeconds(selectedWindow.resetAt),
    windowMinutes:
      typeof selectedWindow.windowMinutes === "number"
        ? selectedWindow.windowMinutes
        : null,
    recordedAt: selectedSample.recordedAt,
  };
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
    | "usage"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  const mergedPrimaryRemaining = getMergedQuotaRemainingPercent(account, "primary");
  const primaryRemaining =
    typeof mergedPrimaryRemaining === "number"
      ? mergedPrimaryRemaining
      : account.usage?.primaryRemainingPercent ?? null;

  // Keep the grouping logic aligned with the UI percent label (rounded).
  // When the 5h budget renders as 0%, the account should not stay in
  // "Working now" even if session telemetry is still present.
  if (
    typeof primaryRemaining === "number" &&
    Math.round(Math.max(0, primaryRemaining)) <= 0
  ) {
    return false;
  }

  if (hasFreshLiveTelemetry(account, nowMs)) {
    return true;
  }

  if (getFreshDebugRawSampleCount(account, nowMs) > 0) {
    return true;
  }

  return Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0;
}
