import { describe, expect, it } from "vitest";

import {
  readRecentOnlineRuntimeIds,
  syncRecentOnlineRuntimeIds,
} from "./runtime-presence-cache";

function createMemoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    setItem(key: string, value: string) {
      entries.set(key, value);
    },
  };
}

describe("runtime presence cache", () => {
  it("keeps recently online runtimes available when the next snapshot is offline", () => {
    const storage = createMemoryStorage();
    const nowMs = Date.UTC(2026, 3, 14, 12, 0, 0);

    const initial = syncRecentOnlineRuntimeIds(
      [{ runtimeId: "account:alpha", status: "online" }],
      { storage, nowMs, graceMs: 60_000 },
    );
    expect(initial.has("account:alpha")).toBe(true);

    const afterOfflineRefresh = syncRecentOnlineRuntimeIds(
      [{ runtimeId: "account:alpha", status: "offline" }],
      { storage, nowMs: nowMs + 45_000, graceMs: 60_000 },
    );
    expect(afterOfflineRefresh.has("account:alpha")).toBe(true);
  });

  it("drops cached runtimes after the grace window elapses", () => {
    const storage = createMemoryStorage();
    const nowMs = Date.UTC(2026, 3, 14, 12, 0, 0);

    syncRecentOnlineRuntimeIds(
      [{ runtimeId: "account:alpha", status: "online" }],
      { storage, nowMs, graceMs: 60_000 },
    );

    const expired = readRecentOnlineRuntimeIds({
      storage,
      nowMs: nowMs + 61_000,
      graceMs: 60_000,
    });

    expect(expired.has("account:alpha")).toBe(false);
  });

  it("ignores invalid stored payloads", () => {
    const storage = createMemoryStorage();
    storage.setItem("recodee.runtimes.recent-online.v1", "{not valid json");

    const result = readRecentOnlineRuntimeIds({
      storage,
      nowMs: Date.UTC(2026, 3, 14, 12, 0, 0),
      graceMs: 60_000,
    });

    expect(result.size).toBe(0);
  });
});
