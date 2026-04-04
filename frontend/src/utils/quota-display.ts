type QuotaDisplayInput = {
  accountKey?: string | null;
  windowKey: "primary" | "secondary";
  remainingPercent: number | null;
  resetAt: string | null | undefined;
  hasLiveSession?: boolean;
  liveUsageConfidence?: "high" | "low" | null;
  lastRecordedAt?: string | null;
  staleAfterMs?: number;
  nowMs?: number;
  applyCycleFloor?: boolean;
};

const DEFAULT_LIVE_STALE_AFTER_MS = 6 * 60 * 1000;
const quotaDisplayFloorCache = new Map<
  string,
  {
    resetAtMs: number | null;
    lowestRemainingPercent: number;
  }
>();

function parseRecordedAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  return timestampMs;
}

function parseResetAtMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) return null;
  return timestampMs;
}

function floorRemainingPercentByCycle({
  accountKey,
  windowKey,
  resetAtMs,
  nowMs,
  remainingPercent,
}: {
  accountKey: string | null | undefined;
  windowKey: "primary" | "secondary";
  resetAtMs: number | null;
  nowMs: number;
  remainingPercent: number;
}): number {
  const normalizedAccountKey = accountKey?.trim();
  if (!normalizedAccountKey) {
    return remainingPercent;
  }

  const cacheKey = `${windowKey}:${normalizedAccountKey}`;
  const existing = quotaDisplayFloorCache.get(cacheKey);
  const resetCycleExpired =
    existing?.resetAtMs != null &&
    nowMs >= existing.resetAtMs;
  if (!existing || resetCycleExpired || existing.resetAtMs !== resetAtMs) {
    quotaDisplayFloorCache.set(cacheKey, {
      resetAtMs,
      lowestRemainingPercent: remainingPercent,
    });
    return remainingPercent;
  }

  const lowestRemainingPercent = Math.min(existing.lowestRemainingPercent, remainingPercent);
  quotaDisplayFloorCache.set(cacheKey, {
    resetAtMs,
    lowestRemainingPercent,
  });
  return lowestRemainingPercent;
}

export function resetQuotaDisplayFloorCacheForTests(): void {
  quotaDisplayFloorCache.clear();
}

export function resetQuotaDisplayFloorCacheForAccount(
  accountKey: string | null | undefined,
): void {
  const normalizedAccountKey = accountKey?.trim();
  if (!normalizedAccountKey) {
    return;
  }
  quotaDisplayFloorCache.delete(`primary:${normalizedAccountKey}`);
  quotaDisplayFloorCache.delete(`secondary:${normalizedAccountKey}`);
}

export function normalizeRemainingPercentForDisplay({
  accountKey,
  windowKey,
  remainingPercent,
  resetAt,
  hasLiveSession = false,
  liveUsageConfidence = null,
  lastRecordedAt,
  staleAfterMs = DEFAULT_LIVE_STALE_AFTER_MS,
  nowMs = Date.now(),
  applyCycleFloor = true,
}: QuotaDisplayInput): number | null {
  let normalizedRemainingPercent = remainingPercent;

  if (hasLiveSession) {
    if (liveUsageConfidence === "low") {
      return null;
    }
    if (remainingPercent === null) {
      return null;
    }
    const recordedAtMs = parseRecordedAtMs(lastRecordedAt);
    if (recordedAtMs === null) {
      return null;
    }
    const ageMs = nowMs - recordedAtMs;
    if (ageMs > staleAfterMs) {
      return null;
    }
  }

  if (normalizedRemainingPercent === null) {
    return null;
  }

  if (applyCycleFloor) {
    normalizedRemainingPercent = floorRemainingPercentByCycle({
      accountKey,
      windowKey,
      resetAtMs: parseResetAtMs(resetAt),
      nowMs,
      remainingPercent: normalizedRemainingPercent,
    });
  }

  return normalizedRemainingPercent;
}
