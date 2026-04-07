import type { AccountSummary } from "@/features/accounts/schemas";

const LIVE_TELEMETRY_STALE_AFTER_MS = 5 * 60 * 1000;
const LIVE_TELEMETRY_WORKING_GRACE_AFTER_MS = 20 * 60 * 1000;
const WORKING_NOW_LIMIT_HIT_GRACE_MS = 60 * 1000;
const WORKING_NOW_DEPLETED_QUOTA_THRESHOLD_PERCENT = 5;
const WORKING_NOW_LOW_QUOTA_FALLBACK_THRESHOLD_PERCENT = 15;
const RECENT_USAGE_SIGNAL_STALE_AFTER_MS = 36 * 60 * 60 * 1000;
const RESET_ALIGNMENT_TOLERANCE_MS = 30 * 1000;
const STATUS_ONLY_TASK_PREVIEW_RE =
  /^(?:task\s+)?(?:is\s+)?(?:already\s+)?(?:done|complete(?:d)?|finished)(?:\s+already)?[.!]?$/i;

type UsageLimitHitEntry = {
  fingerprint: string;
  startedAtMs: number;
};

const usageLimitHitByAccount = new Map<string, UsageLimitHitEntry>();

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

function getScopedQuotaDebugSamples(
  account: Pick<AccountSummary, "codexAuth" | "liveQuotaDebug">,
) {
  const rawSamples = account.liveQuotaDebug?.rawSamples ?? [];
  const targetSnapshot =
    normalizeSnapshotName(account.codexAuth?.expectedSnapshotName) ??
    normalizeSnapshotName(account.codexAuth?.snapshotName);
  if (!targetSnapshot) {
    return rawSamples;
  }

  const exactSnapshotMatch = rawSamples.filter(
    (sample) => normalizeSnapshotName(sample.snapshotName) === targetSnapshot,
  );
  if (exactSnapshotMatch.length > 0) {
    return exactSnapshotMatch;
  }

  const unnamedSamples = rawSamples.filter(
    (sample) => normalizeSnapshotName(sample.snapshotName) == null,
  );
  if (unnamedSamples.length === 0) {
    return [];
  }

  const consideredSnapshots = (account.liveQuotaDebug?.snapshotsConsidered ?? [])
    .map((snapshot) => normalizeSnapshotName(snapshot))
    .filter((snapshot): snapshot is string => snapshot != null);
  const consideredOnlyTarget =
    consideredSnapshots.length === 0 ||
    consideredSnapshots.every((snapshot) => snapshot === targetSnapshot);
  return consideredOnlyTarget ? unnamedSamples : [];
}

function shouldSuppressNoCliSampleSessionSignal(
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
  nowMs: number,
): boolean {
  const overrideReason = (account.liveQuotaDebug?.overrideReason ?? "").trim().toLowerCase();
  if (overrideReason !== "no_live_telemetry") {
    return false;
  }

  const scopedSamples = getScopedQuotaDebugSamples(account);
  if (scopedSamples.length > 0) {
    return false;
  }

  const hasSessionCounterSignal =
    Math.max(
      account.codexLiveSessionCount ?? 0,
      account.codexTrackedSessionCount ?? 0,
      account.codexSessionCount ?? 0,
      0,
    ) > 0;
  if (hasSessionCounterSignal) {
    return false;
  }

  if (hasFreshLiveTelemetry(account, nowMs)) {
    return false;
  }

  const hasSnapshotLiveSession = account.codexAuth?.hasLiveSession ?? false;
  if (hasSnapshotLiveSession) {
    return false;
  }

  return true;
}

function shouldSuppressConfidentCrossAccountSessionSignal(
  account: Pick<
    AccountSummary,
    | "liveQuotaDebug"
    | "codexAuth"
    | "codexLiveSessionCount"
    | "codexTrackedSessionCount"
    | "codexSessionCount"
    | "codexCurrentTaskPreview"
    | "codexSessionTaskPreviews"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
): boolean {
  const overrideReason = (account.liveQuotaDebug?.overrideReason ?? "").trim().toLowerCase();
  if (overrideReason !== "live_usage_confident_match_other_account") {
    return false;
  }
  return account.liveQuotaDebug?.overrideApplied !== true;
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
  account: Pick<AccountSummary, "liveQuotaDebug" | "codexAuth">,
  nowMs: number = Date.now(),
): number {
  const rawSamples = getScopedQuotaDebugSamples(account);
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
  account: Pick<AccountSummary, "liveQuotaDebug" | "codexAuth">,
  windowKey: "primary" | "secondary",
): number | null {
  const liveQuotaDebug = account.liveQuotaDebug;
  const merged = liveQuotaDebug?.merged;
  if (!merged || merged.stale === true) {
    return null;
  }

  const overrideReason = (liveQuotaDebug?.overrideReason ?? "").trim();
  const normalizedOverrideReason = overrideReason.toLowerCase();
  if (
    normalizedOverrideReason === "live_usage_confident_match_other_account" &&
    liveQuotaDebug?.overrideApplied !== true
  ) {
    return null;
  }
  const deferredMixedDefaultSessions =
    overrideReason.startsWith("deferred_active_snapshot_mixed_default_sessions");
  if (deferredMixedDefaultSessions && liveQuotaDebug?.overrideApplied !== true) {
    return null;
  }

  const normalizeSnapshots = (snapshots: Array<string>) =>
    snapshots
      .map((snapshot) => normalizeSnapshotName(snapshot))
      .filter((snapshot): snapshot is string => snapshot != null);

  const targetSnapshot =
    normalizeSnapshotName(account.codexAuth?.expectedSnapshotName) ??
    normalizeSnapshotName(account.codexAuth?.snapshotName);
  const mergedSnapshot = normalizeSnapshotName(merged.snapshotName);
  const consideredSnapshots = normalizeSnapshots(liveQuotaDebug?.snapshotsConsidered ?? []);

  if (targetSnapshot) {
    if (mergedSnapshot && mergedSnapshot !== targetSnapshot) {
      return null;
    }
    if (
      !mergedSnapshot &&
      consideredSnapshots.length > 0 &&
      consideredSnapshots.some((snapshot) => snapshot !== targetSnapshot)
    ) {
      return null;
    }
  } else if (consideredSnapshots.length > 1) {
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
    reason === "no_live_telemetry"
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

  const targetSnapshot =
    normalizeSnapshotName(account.codexAuth?.expectedSnapshotName) ??
    normalizeSnapshotName(account.codexAuth?.snapshotName);
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

function hasFreshTaskPreviewSignal(
  account: Pick<AccountSummary, "codexCurrentTaskPreview" | "codexSessionTaskPreviews">,
): boolean {
  const isMeaningfulTaskPreview = (
    taskPreview: string | null | undefined,
  ): boolean => {
    const normalized = taskPreview?.trim().replace(/\s+/g, " ") ?? "";
    if (!normalized) {
      return false;
    }
    if (/^warning\b/i.test(normalized)) {
      return false;
    }
    if (STATUS_ONLY_TASK_PREVIEW_RE.test(normalized)) {
      return false;
    }
    return true;
  };

  if (isMeaningfulTaskPreview(account.codexCurrentTaskPreview)) {
    return true;
  }

  const sessionTaskPreviews = account.codexSessionTaskPreviews ?? [];
  for (const preview of sessionTaskPreviews) {
    if (!isMeaningfulTaskPreview(preview.taskPreview)) {
      continue;
    }
    // Session rows represent concrete tracked Codex sessions; keep them as
    // active CLI evidence until they resolve to a finished/status-only preview.
    return true;
  }

  return false;
}

export function hasActiveCliSessionSignal(
  account: Pick<
    AccountSummary,
    | "accountId"
    | "codexAuth"
    | "codexLiveSessionCount"
    | "codexTrackedSessionCount"
    | "codexSessionCount"
    | "liveQuotaDebug"
    | "codexCurrentTaskPreview"
    | "codexSessionTaskPreviews"
    | "usage"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  if (shouldSuppressConfidentCrossAccountSessionSignal(account)) {
    return false;
  }
  // CLI session detection flow is intentionally hard-coded and order-sensitive.
  // Keep this as a strict cascade so the UI remains stable:
  //   1) codexAuth.hasLiveSession
  //   2) fresh live telemetry (including live process count)
  //   3) tracked/compat counters or fresh current-task preview
  //   4) fresh raw debug samples
  // Any change here must be explicitly requested and protected by regression tests.
  const hasHardSignal =
    (account.codexAuth?.hasLiveSession ?? false) ||
    hasFreshLiveTelemetry(account, nowMs) ||
    Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0 ||
    hasFreshTaskPreviewSignal(account) ||
    getFreshDebugRawSampleCount(account, nowMs) > 0;
  if (!hasHardSignal) {
    return false;
  }
  if (shouldSuppressNoCliSampleSessionSignal(account, nowMs)) {
    return false;
  }

  return true;
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

type WorkingNowAccount = Pick<
  AccountSummary,
  | "accountId"
  | "codexAuth"
  | "resetAtPrimary"
  | "codexLiveSessionCount"
  | "codexSessionCount"
  | "codexTrackedSessionCount"
  | "liveQuotaDebug"
  | "codexCurrentTaskPreview"
  | "codexSessionTaskPreviews"
  | "usage"
  | "lastUsageRecordedAtPrimary"
  | "lastUsageRecordedAtSecondary"
>;

function buildWorkingNowSessionFingerprint(account: WorkingNowAccount): string {
  const targetSnapshot =
    normalizeSnapshotName(account.codexAuth?.expectedSnapshotName) ??
    normalizeSnapshotName(account.codexAuth?.snapshotName) ??
    "none";
  const rawSnapshots = (account.liveQuotaDebug?.rawSamples ?? [])
    .filter((sample) => sample.stale !== true)
    .map((sample) => normalizeSnapshotName(sample.snapshotName) ?? "none")
    .sort();
  const snapshotsFingerprint =
    rawSnapshots.length > 0 ? rawSnapshots.join("|") : "raw:none";
  const countersFingerprint = [
    Math.max(account.codexLiveSessionCount ?? 0, 0),
    Math.max(account.codexTrackedSessionCount ?? 0, 0),
    Math.max(account.codexSessionCount ?? 0, 0),
  ].join("/");
  const taskPreview = account.codexCurrentTaskPreview?.trim() || "";
  const taskFingerprint = (() => {
    if (!taskPreview) {
      return "task:none";
    }
    // live_usage payloads include volatile timestamps/counters that rotate on
    // every poll. Keeping them verbatim restarts the usage-limit grace window.
    if (/^<live_usage\b/i.test(taskPreview)) {
      return "task:live_usage";
    }
    const normalizedTaskPreview = taskPreview
      .replace(
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/g,
        "<ts>",
      )
      .replace(/\s+/g, " ")
      .trim();
    return `task:${normalizedTaskPreview}`;
  })();

  // Do not include volatile rollout file names / merged source ids here.
  // They can rotate on every telemetry poll and would keep restarting the
  // 60-second usage-limit grace window for the same stuck session.
  return [
    targetSnapshot,
    snapshotsFingerprint,
    `counters:${countersFingerprint}`,
    taskFingerprint,
  ].join("::");
}

function buildWorkingNowLimitHitCacheKey(account: WorkingNowAccount): string {
  const targetSnapshot =
    normalizeSnapshotName(account.codexAuth?.expectedSnapshotName) ??
    normalizeSnapshotName(account.codexAuth?.snapshotName) ??
    "none";
  return `${account.accountId}::${targetSnapshot}`;
}

function isDepletedPrimaryQuota(value: number | null | undefined): boolean {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return false;
  }
  return (
    Math.max(0, value) < WORKING_NOW_DEPLETED_QUOTA_THRESHOLD_PERCENT
  );
}

function resolveWorkingNowPrimaryQuota(
  account: WorkingNowAccount,
  nowMs: number,
): {
  mergedPrimaryRemaining: number | null;
  deferredPrimaryQuotaFallback: RawQuotaWindowFallback | null;
  primaryRemaining: number | null;
} {
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

  return {
    mergedPrimaryRemaining,
    deferredPrimaryQuotaFallback,
    primaryRemaining,
  };
}

function hasStrongWorkingNowSessionEvidence(
  account: WorkingNowAccount,
  nowMs: number,
): boolean {
  const hasActiveSessionCounterSignal =
    Math.max(
      account.codexLiveSessionCount ?? 0,
      account.codexTrackedSessionCount ?? 0,
      account.codexSessionCount ?? 0,
      0,
    ) > 0;
  if (hasActiveSessionCounterSignal) {
    return true;
  }

  if (hasFreshTaskPreviewSignal(account)) {
    return true;
  }

  return hasFreshLiveTelemetry(account, nowMs);
}

export function getWorkingNowUsageLimitHitCountdownMs(
  account: WorkingNowAccount,
  nowMs: number = Date.now(),
): number | null {
  if (shouldSuppressConfidentCrossAccountSessionSignal(account)) {
    return null;
  }
  const cacheKey = buildWorkingNowLimitHitCacheKey(account);
  const hasActiveSessionCounterSignal =
    Math.max(
      account.codexLiveSessionCount ?? 0,
      account.codexTrackedSessionCount ?? 0,
      account.codexSessionCount ?? 0,
      0,
    ) > 0;
  const hasTaskPreviewSignal = hasFreshTaskPreviewSignal(account);
  const hasActiveCliSessionSignal =
    hasActiveSessionCounterSignal ||
    (account.codexAuth?.hasLiveSession ?? false) ||
    hasTaskPreviewSignal;
  if (!hasActiveCliSessionSignal) {
    return null;
  }
  if (shouldSuppressNoCliSampleSessionSignal(account, nowMs)) {
    return null;
  }

  const quotaState = resolveWorkingNowPrimaryQuota(account, nowMs);
  const hasDepletedPrimaryQuota =
    isDepletedPrimaryQuota(quotaState.mergedPrimaryRemaining) ||
    isDepletedPrimaryQuota(quotaState.primaryRemaining);
  if (!hasDepletedPrimaryQuota) {
    usageLimitHitByAccount.delete(cacheKey);
    return null;
  }

  const existing = usageLimitHitByAccount.get(cacheKey);
  if (existing) {
    const existingElapsedMs = Math.max(0, nowMs - existing.startedAtMs);
    if (existingElapsedMs >= WORKING_NOW_LIMIT_HIT_GRACE_MS) {
      return 0;
    }
  }

  const sessionFingerprint = buildWorkingNowSessionFingerprint(account);
  const startedAtMs =
    existing && existing.fingerprint === sessionFingerprint
      ? existing.startedAtMs
      : nowMs;
  if (!existing || existing.fingerprint !== sessionFingerprint) {
    usageLimitHitByAccount.set(cacheKey, {
      fingerprint: sessionFingerprint,
      startedAtMs,
    });
  }

  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  return Math.max(0, WORKING_NOW_LIMIT_HIT_GRACE_MS - elapsedMs);
}

export function isAccountWorkingNow(
  account: Pick<
    AccountSummary,
    | "accountId"
    | "codexAuth"
    | "resetAtPrimary"
    | "status"
    | "codexLiveSessionCount"
    | "codexSessionCount"
    | "codexTrackedSessionCount"
    | "liveQuotaDebug"
    | "codexCurrentTaskPreview"
    | "codexSessionTaskPreviews"
    | "usage"
    | "lastUsageRecordedAtPrimary"
    | "lastUsageRecordedAtSecondary"
  >,
  nowMs: number = Date.now(),
): boolean {
  if (shouldSuppressConfidentCrossAccountSessionSignal(account)) {
    return false;
  }
  const hasFreshLiveSession = hasFreshLiveTelemetry(account, nowMs);
  const hasGraceLiveSessionHint = (() => {
    if (!(account.codexAuth?.hasLiveSession ?? false)) {
      return false;
    }

    const isWithinGraceWindow = (value: string | null | undefined): boolean => {
      const recordedAtMs = parseRecordedAtMs(value);
      if (recordedAtMs == null) return false;
      return nowMs - recordedAtMs <= LIVE_TELEMETRY_WORKING_GRACE_AFTER_MS;
    };

    return (
      isWithinGraceWindow(account.lastUsageRecordedAtPrimary) ||
      isWithinGraceWindow(account.lastUsageRecordedAtSecondary)
    );
  })();
  const hasActiveSessionCounterSignal =
    Math.max(
      account.codexLiveSessionCount ?? 0,
      account.codexTrackedSessionCount ?? 0,
      account.codexSessionCount ?? 0,
      0,
    ) > 0;
  const hasTaskPreviewSignal = hasFreshTaskPreviewSignal(account);
  const hasActiveCliSessionSignal =
    hasActiveSessionCounterSignal ||
    (account.codexAuth?.hasLiveSession ?? false) ||
    hasTaskPreviewSignal;
  // Keep disconnected accounts out of "Working now" unless they still have a
  // verifiable live session signal.
  if (account.status === "deactivated" && !hasFreshLiveSession) {
    return false;
  }
  if (shouldSuppressNoCliSampleSessionSignal(account, nowMs)) {
    return false;
  }

  const quotaState = resolveWorkingNowPrimaryQuota(account, nowMs);
  const hasDepletedPrimaryQuota =
    isDepletedPrimaryQuota(quotaState.mergedPrimaryRemaining) ||
    isDepletedPrimaryQuota(quotaState.primaryRemaining);

  // Keep the grouping logic aligned with the UI percent label (rounded).
  // When the 5h budget renders as 0%, the account should not stay in
  // "Working now" unless it still has an active CLI session signal.
  if (hasDepletedPrimaryQuota) {
    if (!hasActiveCliSessionSignal) {
      return false;
    }

    const usageLimitHitCountdownMs = getWorkingNowUsageLimitHitCountdownMs(
      account,
      nowMs,
    );
    if (usageLimitHitCountdownMs != null && usageLimitHitCountdownMs <= 0) {
      const primaryResetAtMs =
        parseResetAtMs(account.resetAtPrimary) ??
        parseResetAtMs(quotaState.deferredPrimaryQuotaFallback?.resetAt);
      // Once an account hits the 5h usage limit and the grace window expires,
      // keep it out of "Working now" until the 5h window reset is reached.
      if (primaryResetAtMs == null || nowMs < primaryResetAtMs) {
        return false;
      }
      if (!hasStrongWorkingNowSessionEvidence(account, nowMs)) {
        return false;
      }
    }
  }

  if (hasFreshLiveSession) {
    return true;
  }

  if (hasGraceLiveSessionHint) {
    return true;
  }

  if (hasTaskPreviewSignal) {
    return true;
  }

  if (
    (account.codexAuth?.hasLiveSession ?? false) &&
    (account.codexAuth?.isActiveSnapshot ?? false)
  ) {
    return true;
  }

  if (account.codexAuth?.hasLiveSession ?? false) {
    if (hasTaskPreviewSignal) {
      return true;
    }
    if (
      account.lastUsageRecordedAtPrimary == null &&
      account.lastUsageRecordedAtSecondary == null
    ) {
      return true;
    }
  }

  const freshDebugRawSampleCount = getFreshDebugRawSampleCount(account, nowMs);
  if (freshDebugRawSampleCount > 0) {
    const overrideReason = (account.liveQuotaDebug?.overrideReason ?? "").trim().toLowerCase();
    const deferredMixedDefaultSessions =
      overrideReason.startsWith("deferred_active_snapshot_mixed_default_sessions");
    if (deferredMixedDefaultSessions) {
      if (!hasActiveCliSessionSignal) {
        return false;
      }
      return true;
    }

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

  const hasCodexSnapshotVisibility = account.codexAuth?.hasSnapshot ?? false;
  const primaryRemainingPercent = account.usage?.primaryRemainingPercent;
  const hasLowQuotaFallbackWorkingSignal =
    !hasCodexSnapshotVisibility &&
    account.status !== "deactivated" &&
    typeof primaryRemainingPercent === "number" &&
    Number.isFinite(primaryRemainingPercent) &&
    primaryRemainingPercent <= WORKING_NOW_LOW_QUOTA_FALLBACK_THRESHOLD_PERCENT;
  if (hasLowQuotaFallbackWorkingSignal) {
    return true;
  }

  return Math.max(account.codexTrackedSessionCount ?? 0, account.codexSessionCount ?? 0, 0) > 0;
}

export function resetWorkingNowLimitHitStateForTests(): void {
  usageLimitHitByAccount.clear();
}
