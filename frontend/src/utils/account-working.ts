import type { AccountSummary } from "@/features/accounts/schemas";

const LIVE_TELEMETRY_STALE_AFTER_MS = 5 * 60 * 1000;
const RECENT_USAGE_SIGNAL_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const RESET_ALIGNMENT_TOLERANCE_MS = 30 * 1000;

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
    reason === "no_live_telemetry" ||
    reason.startsWith("deferred_active_snapshot_mixed_default_sessions")
  );
}

function parseResetAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  return timestampMs;
}

export function selectStableRemainingPercent({
  fallbackRemainingPercent,
  fallbackResetAt,
  baselineRemainingPercent,
  baselineResetAt,
}: {
  fallbackRemainingPercent: number | null | undefined;
  fallbackResetAt: string | null | undefined;
  baselineRemainingPercent: number | null | undefined;
  baselineResetAt: string | null | undefined;
}): number | null {
  const fallback =
    typeof fallbackRemainingPercent === "number" &&
    Number.isFinite(fallbackRemainingPercent)
      ? fallbackRemainingPercent
      : null;
  const baseline =
    typeof baselineRemainingPercent === "number" &&
    Number.isFinite(baselineRemainingPercent)
      ? baselineRemainingPercent
      : null;

  if (fallback == null) return baseline;
  if (baseline == null) return fallback;

  const fallbackResetMs = parseResetAtMs(fallbackResetAt);
  const baselineResetMs = parseResetAtMs(baselineResetAt);
  if (fallbackResetMs != null && baselineResetMs != null) {
    const delta = Math.abs(fallbackResetMs - baselineResetMs);
    if (delta > RESET_ALIGNMENT_TOLERANCE_MS) {
      return fallbackResetMs > baselineResetMs ? fallback : baseline;
    }
  }

  return Math.min(fallback, baseline);
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
    });

  // Keep UI fallback ordering aligned with backend debug ordering.
  // Backend already emits rawSamples in priority order (newest/most reliable
  // candidate first), and re-sorting here can make the quota bar disagree with
  // the "cli-session#1" line shown in CLI SESSION LOGS.

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

  const getWindow = (sample: (typeof scoped)[number]) =>
    windowKey === "primary" ? sample.primary : sample.secondary;

  const withResetAt = scoped.filter((sample) => {
    const resetAt = getWindow(sample)?.resetAt;
    return typeof resetAt === "number" && Number.isFinite(resetAt) && resetAt > 0;
  });

  let cycleScoped = scoped;
  if (withResetAt.length > 0) {
    const latestResetAt = Math.max(
      ...withResetAt.map((sample) => getWindow(sample)?.resetAt ?? 0),
    );
    cycleScoped = withResetAt.filter(
      (sample) => (getWindow(sample)?.resetAt ?? null) === latestResetAt,
    );
  }

  const selectedSample = [...cycleScoped].sort((left, right) => {
    const leftRemaining = getWindow(left)?.remainingPercent ?? Number.POSITIVE_INFINITY;
    const rightRemaining = getWindow(right)?.remainingPercent ?? Number.POSITIVE_INFINITY;
    if (leftRemaining !== rightRemaining) {
      return leftRemaining - rightRemaining;
    }
    const leftMs = parseRecordedAtMs(left.recordedAt) ?? 0;
    const rightMs = parseRecordedAtMs(right.recordedAt) ?? 0;
    return rightMs - leftMs;
  })[0];
  if (!selectedSample) {
    return null;
  }

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

export function hasActiveCliSessionSignal(
  account: Pick<
    AccountSummary,
    | "codexAuth"
    | "codexLiveSessionCount"
    | "codexTrackedSessionCount"
    | "codexSessionCount"
    | "liveQuotaDebug"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  if (account.codexAuth?.hasLiveSession ?? false) {
    return true;
  }

  if (hasFreshLiveTelemetry(account, nowMs)) {
    return true;
  }

  if (Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0) {
    return true;
  }

  return getFreshDebugRawSampleCount(account, nowMs) > 0;
}

export function hasRecentUsageSignal(
  account: Pick<
    AccountSummary,
    "lastUsageRecordedAtPrimary" | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  const hasRecentTimestamp = (
    value: string | null | undefined,
    staleAfterMs: number,
  ): boolean => {
    const recordedAtMs = parseRecordedAtMs(value);
    if (recordedAtMs == null) return false;
    return nowMs - recordedAtMs <= staleAfterMs;
  };

  return (
    hasRecentTimestamp(account.lastUsageRecordedAtPrimary, RECENT_USAGE_SIGNAL_STALE_AFTER_MS) ||
    hasRecentTimestamp(
      account.lastUsageRecordedAtSecondary,
      RECENT_USAGE_SIGNAL_STALE_AFTER_MS,
    )
  );
}

export function isAccountWorkingNow(
  account: Pick<
    AccountSummary,
    | "codexAuth"
    | "status"
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
  const hasFreshLiveSession = hasFreshLiveTelemetry(account, nowMs);
  // Keep disconnected accounts out of "Working now" unless they still have a
  // verifiable live session signal.
  if (account.status === "deactivated" && !hasFreshLiveSession) {
    return false;
  }

  const mergedPrimaryRemaining = getMergedQuotaRemainingPercent(account, "primary");
  const deferredPrimaryQuotaFallback = getRawQuotaWindowFallback(account, "primary");
  const freshDeferredPrimaryRemaining = (() => {
    if (!deferredPrimaryQuotaFallback) return null;
    if (!isFreshTimestamp(deferredPrimaryQuotaFallback.recordedAt, nowMs)) return null;
    return deferredPrimaryQuotaFallback.remainingPercent;
  })();
  const primaryRemaining =
    mergedPrimaryRemaining ??
    freshDeferredPrimaryRemaining ??
    account.usage?.primaryRemainingPercent ??
    null;

  // Keep the grouping logic aligned with the UI percent label (rounded).
  // When the 5h budget renders as 0%, the account should not stay in
  // "Working now" even if session telemetry is still present.
  if (
    typeof primaryRemaining === "number" &&
    Math.round(Math.max(0, primaryRemaining)) <= 0
  ) {
    return false;
  }

  if (hasFreshLiveSession) {
    return true;
  }

  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account, nowMs);
  if (freshDebugRawSampleCount > 0) {
    const primaryFallbackRecordedAt = getRawQuotaWindowFallback(account, "primary")?.recordedAt;
    if (isFreshTimestamp(primaryFallbackRecordedAt, nowMs)) {
      return true;
    }

    const secondaryFallbackRecordedAt =
      getRawQuotaWindowFallback(account, "secondary")?.recordedAt;
    if (isFreshTimestamp(secondaryFallbackRecordedAt, nowMs)) {
      return true;
    }
  }

  return Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0;
}
