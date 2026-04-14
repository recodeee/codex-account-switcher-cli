export type RuntimePresenceSnapshot = {
  runtimeId: string;
  status: "online" | "offline";
};

type RuntimePresenceCachePayload = {
  version: 1;
  onlineSeenAtByRuntimeId: Record<string, number>;
};

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const CACHE_KEY = "recodee.runtimes.recent-online.v1";
const CACHE_VERSION = 1;
export const RECENT_ONLINE_RUNTIME_GRACE_MS = 2 * 60 * 60 * 1000;

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) {
    return storage;
  }
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function parseCachePayload(raw: string | null): RuntimePresenceCachePayload {
  if (!raw) {
    return { version: CACHE_VERSION, onlineSeenAtByRuntimeId: {} };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<RuntimePresenceCachePayload> | null;
    if (!parsed || parsed.version !== CACHE_VERSION || typeof parsed.onlineSeenAtByRuntimeId !== "object") {
      return { version: CACHE_VERSION, onlineSeenAtByRuntimeId: {} };
    }
    const normalized: Record<string, number> = {};
    for (const [runtimeId, seenAt] of Object.entries(parsed.onlineSeenAtByRuntimeId)) {
      if (
        typeof runtimeId === "string"
        && runtimeId.length > 0
        && typeof seenAt === "number"
        && Number.isFinite(seenAt)
        && seenAt > 0
      ) {
        normalized[runtimeId] = seenAt;
      }
    }
    return {
      version: CACHE_VERSION,
      onlineSeenAtByRuntimeId: normalized,
    };
  } catch {
    return { version: CACHE_VERSION, onlineSeenAtByRuntimeId: {} };
  }
}

function pruneOnlineRuntimeMap(
  onlineSeenAtByRuntimeId: Record<string, number>,
  *,
  nowMs: number,
  graceMs: number,
): Record<string, number> {
  const pruned: Record<string, number> = {};
  for (const [runtimeId, seenAt] of Object.entries(onlineSeenAtByRuntimeId)) {
    if (nowMs - seenAt <= graceMs) {
      pruned[runtimeId] = seenAt;
    }
  }
  return pruned;
}

function toRuntimeIdSet(onlineSeenAtByRuntimeId: Record<string, number>): Set<string> {
  return new Set(Object.keys(onlineSeenAtByRuntimeId));
}

function writeCachePayload(storage: StorageLike | null, payload: RuntimePresenceCachePayload): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota/privacy mode failures; this cache is best-effort.
  }
}

export function readRecentOnlineRuntimeIds(options?: {
  nowMs?: number;
  graceMs?: number;
  storage?: StorageLike;
}): Set<string> {
  const nowMs = options?.nowMs ?? Date.now();
  const graceMs = options?.graceMs ?? RECENT_ONLINE_RUNTIME_GRACE_MS;
  const storage = resolveStorage(options?.storage);
  const payload = parseCachePayload(storage?.getItem(CACHE_KEY) ?? null);
  const pruned = pruneOnlineRuntimeMap(payload.onlineSeenAtByRuntimeId, { nowMs, graceMs });
  if (Object.keys(pruned).length !== Object.keys(payload.onlineSeenAtByRuntimeId).length) {
    writeCachePayload(storage, { version: CACHE_VERSION, onlineSeenAtByRuntimeId: pruned });
  }
  return toRuntimeIdSet(pruned);
}

export function syncRecentOnlineRuntimeIds(
  snapshots: RuntimePresenceSnapshot[],
  options?: {
    nowMs?: number;
    graceMs?: number;
    storage?: StorageLike;
  },
): Set<string> {
  const nowMs = options?.nowMs ?? Date.now();
  const graceMs = options?.graceMs ?? RECENT_ONLINE_RUNTIME_GRACE_MS;
  const storage = resolveStorage(options?.storage);
  const payload = parseCachePayload(storage?.getItem(CACHE_KEY) ?? null);
  const nextMap = pruneOnlineRuntimeMap(payload.onlineSeenAtByRuntimeId, { nowMs, graceMs });

  for (const snapshot of snapshots) {
    if (snapshot.status === "online") {
      nextMap[snapshot.runtimeId] = nowMs;
    }
  }

  writeCachePayload(storage, { version: CACHE_VERSION, onlineSeenAtByRuntimeId: nextMap });
  return toRuntimeIdSet(nextMap);
}
