import { describe, expect, it } from "vitest";

import { createAccountSummary } from "@/test/mocks/factories";
import {
  getWorkingNowUsageLimitHitCountdownMs,
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  isAccountWorkingNow,
  selectStableRemainingPercent,
} from "@/utils/account-working";

describe("isAccountWorkingNow", () => {
  it("returns true when codex auth reports a live session with fresh telemetry", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:57:00.000Z",
    });
    expect(isAccountWorkingNow(account, now.getTime())).toBe(true);
  });

  it("returns true when a live process session count is present", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 2,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true when tracked codex sessions are present", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 3,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true when 5h is depleted but tracked sessions are still present", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 3,
      codexSessionCount: 3,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:59:00.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:59:00.000Z",
    });

    expect(isAccountWorkingNow(account, new Date("2026-04-04T11:59:40.000Z").getTime())).toBe(true);
  });

  it("returns true when 5h rounds down to 0% and live sessions are still present", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0.4,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:59:00.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:59:00.000Z",
    });

    expect(isAccountWorkingNow(account, new Date("2026-04-04T11:59:40.000Z").getTime())).toBe(true);
  });

  it("ages out usage-limit-hit accounts after 60 seconds even with active session signals", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:30.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:58:30.000Z",
    });

    expect(isAccountWorkingNow(account, new Date("2026-04-04T11:59:00.000Z").getTime())).toBe(true);
    expect(isAccountWorkingNow(account, new Date("2026-04-04T11:59:31.000Z").getTime())).toBe(false);
  });

  it("returns a 60-second usage-limit countdown while account is still eligible for working-now", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:30.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:58:30.000Z",
    });

    const nowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    const countdownMs = getWorkingNowUsageLimitHitCountdownMs(account, nowMs);
    expect(countdownMs).toBeGreaterThanOrEqual(29_000);
    expect(countdownMs).toBeLessThanOrEqual(30_000);
  });

  it("returns false when no-live-telemetry fallback reports 0% even if baseline usage is higher", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 28,
        secondaryRemainingPercent: 50,
      },
      resetAtPrimary: "2026-04-04T14:10:00.000Z",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "tokio",
        activeSnapshotName: "amodeus",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["tokio"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-tokio.jsonl",
            snapshotName: "tokio",
            recordedAt: "2026-04-04T11:57:36.000Z",
            stale: false,
            primary: { usedPercent: 100, remainingPercent: 0, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 50, remainingPercent: 50, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
  });

  it("returns true when compatibility codexSessionCount is present", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true when only fresh debug raw samples exist", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-a.jsonl",
            snapshotName: "viktor",
            recordedAt: "2026-04-04T11:58:00.000Z",
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    expect(isAccountWorkingNow(account, nowMs)).toBe(true);
  });

  it("returns false when debug raw samples are stale", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "viktor",
        activeSnapshotName: "viktor",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["viktor"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-a.jsonl",
            snapshotName: "viktor",
            recordedAt: "2026-04-04T11:40:00.000Z",
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 32, remainingPercent: 68, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
  });

  it("returns false when account is active snapshot without live sessions", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });
    expect(isAccountWorkingNow(account)).toBe(false);
  });

  it("returns false when live telemetry is stale", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:30:00.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:30:00.000Z",
    });
    expect(isAccountWorkingNow(account, now.getTime())).toBe(false);
  });

  it("keeps live-session accounts in working-now during a short grace window", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:48:00.000Z",
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account, now.getTime())).toBe(true);
  });

  it("returns false when none of the working conditions apply", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });
    expect(isAccountWorkingNow(account)).toBe(false);
  });

  it("ignores deferred mixed-session merged quotas when override was not applied", () => {
    const account = createAccountSummary({
      liveQuotaDebug: {
        snapshotsConsidered: ["korona"],
        overrideApplied: false,
        overrideReason: "deferred_active_snapshot_mixed_default_sessions",
        merged: {
          source: "merged",
          snapshotName: "korona",
          recordedAt: "2026-04-04T11:58:00.000Z",
          stale: false,
          primary: { usedPercent: 84, remainingPercent: 16, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 10, remainingPercent: 90, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });

    expect(getMergedQuotaRemainingPercent(account, "primary")).toBeNull();
    expect(getMergedQuotaRemainingPercent(account, "secondary")).toBeNull();
  });

  it("keeps merged quotas when override was applied", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "korona",
        activeSnapshotName: "korona",
        expectedSnapshotName: "korona",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["korona"],
        overrideApplied: true,
        overrideReason: "applied_live_usage_windows",
        merged: {
          source: "merged",
          snapshotName: "korona",
          recordedAt: "2026-04-04T11:58:00.000Z",
          stale: false,
          primary: { usedPercent: 84, remainingPercent: 16, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 10, remainingPercent: 90, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });

    expect(getMergedQuotaRemainingPercent(account, "primary")).toBe(16);
    expect(getMergedQuotaRemainingPercent(account, "secondary")).toBe(90);
  });

  it("ignores merged quotas when merged snapshot does not match expected snapshot", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "korona",
        activeSnapshotName: "korona",
        expectedSnapshotName: "amodeus",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["korona"],
        overrideApplied: true,
        overrideReason: "applied_live_usage_windows",
        merged: {
          source: "merged",
          snapshotName: "korona",
          recordedAt: "2026-04-04T11:58:00.000Z",
          stale: false,
          primary: { usedPercent: 96, remainingPercent: 4, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 23, remainingPercent: 77, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });

    expect(getMergedQuotaRemainingPercent(account, "primary")).toBeNull();
    expect(getMergedQuotaRemainingPercent(account, "secondary")).toBeNull();
  });

  it("uses raw sample fallback when merged payload has no windows", () => {
    const nowIso = "2026-04-04T11:58:00.000Z";
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "live_session_without_windows",
        merged: {
          source: "merged",
          snapshotName: "odin",
          recordedAt: nowIso,
          stale: false,
          primary: null,
          secondary: null,
        },
        rawSamples: [
          {
            source: "/tmp/rollout-odin.jsonl",
            snapshotName: "odin",
            recordedAt: nowIso,
            stale: false,
            primary: { usedPercent: 61, remainingPercent: 39, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 42, remainingPercent: 58, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")?.remainingPercent).toBe(39);
    expect(getRawQuotaWindowFallback(account, "secondary")?.remainingPercent).toBe(58);
  });

  it("uses raw sample fallback for no-live-telemetry account-attributed samples", () => {
    const nowIso = "2026-04-04T11:58:00.000Z";
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "bia",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-odin.jsonl",
            snapshotName: "odin",
            recordedAt: nowIso,
            stale: false,
            primary: { usedPercent: 61, remainingPercent: 39, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 42, remainingPercent: 58, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")?.remainingPercent).toBe(39);
    expect(getRawQuotaWindowFallback(account, "secondary")?.remainingPercent).toBe(58);
  });

  it("uses the smallest remaining fallback sample within the same quota cycle", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "codexina",
        activeSnapshotName: "codexina",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["codexina"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-1.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T18:16:09.000Z",
            stale: false,
            primary: { usedPercent: 24, remainingPercent: 76, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 53, remainingPercent: 47, resetAt: 1760600000, windowMinutes: 10080 },
          },
          {
            source: "/tmp/rollout-2.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T18:12:07.000Z",
            stale: false,
            primary: { usedPercent: 59, remainingPercent: 41, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 57, remainingPercent: 43, resetAt: 1760600000, windowMinutes: 10080 },
          },
          {
            source: "/tmp/rollout-3.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T18:08:59.000Z",
            stale: false,
            primary: { usedPercent: 7, remainingPercent: 93, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 51, remainingPercent: 49, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")?.remainingPercent).toBe(41);
    expect(getRawQuotaWindowFallback(account, "secondary")?.remainingPercent).toBe(43);
  });

  it("prefers samples from the latest reset cycle over older lower values", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "codexina",
        activeSnapshotName: "codexina",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["codexina"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-latest-cycle.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T20:00:00.000Z",
            stale: false,
            primary: { usedPercent: 2, remainingPercent: 98, resetAt: 1761000000, windowMinutes: 300 },
            secondary: { usedPercent: 5, remainingPercent: 95, resetAt: 1761600000, windowMinutes: 10080 },
          },
          {
            source: "/tmp/rollout-older-cycle.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T17:00:00.000Z",
            stale: false,
            primary: { usedPercent: 90, remainingPercent: 10, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 87, remainingPercent: 13, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")?.remainingPercent).toBe(98);
    expect(getRawQuotaWindowFallback(account, "secondary")?.remainingPercent).toBe(95);
  });

  it("uses the most depleted fallback sample in the current cycle per window", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "codexina",
        activeSnapshotName: "codexina",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["codexina"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-priority-first.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:50:00.000Z",
            stale: false,
            primary: { usedPercent: 24, remainingPercent: 76, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 53, remainingPercent: 47, resetAt: 1760600000, windowMinutes: 10080 },
          },
          {
            source: "/tmp/rollout-later-recorded.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:59:00.000Z",
            stale: false,
            primary: { usedPercent: 4, remainingPercent: 96, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")?.remainingPercent).toBe(76);
    expect(getRawQuotaWindowFallback(account, "secondary")?.remainingPercent).toBe(44);
  });

  it("rejects raw sample fallback when only mismatched snapshot samples are available", () => {
    const nowIso = "2026-04-04T11:58:00.000Z";
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin", "bia"],
        overrideApplied: false,
        overrideReason: "live_session_without_windows",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-bia.jsonl",
            snapshotName: "bia",
            recordedAt: nowIso,
            stale: false,
            primary: { usedPercent: 88, remainingPercent: 12, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 70, remainingPercent: 30, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")).toBeNull();
    expect(getRawQuotaWindowFallback(account, "secondary")).toBeNull();
  });

  it("rejects raw sample fallback when expected snapshot differs from samples", () => {
    const nowIso = "2026-04-04T11:58:00.000Z";
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "korona",
        activeSnapshotName: "korona",
        expectedSnapshotName: "amodeus",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["korona"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-korona.jsonl",
            snapshotName: "korona",
            recordedAt: nowIso,
            stale: false,
            primary: { usedPercent: 96, remainingPercent: 4, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 23, remainingPercent: 77, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(getRawQuotaWindowFallback(account, "primary")).toBeNull();
    expect(getRawQuotaWindowFallback(account, "secondary")).toBeNull();
  });

  it("returns false when merged 5h is depleted", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 90,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 2,
      codexSessionCount: 2,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "amodeus",
        activeSnapshotName: "amodeus",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["amodeus"],
        overrideApplied: true,
        overrideReason: "deferred_active_snapshot_sample_floor_override",
        merged: {
          source: "merged",
          snapshotName: "amodeus",
          recordedAt: "2026-04-04T12:00:00.000Z",
          stale: false,
          primary: { usedPercent: 100, remainingPercent: 0, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 12, remainingPercent: 88, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });

    expect(isAccountWorkingNow(account)).toBe(false);
  });

  it("keeps the lower remaining value when fallback and baseline share reset cycle", () => {
    expect(
      selectStableRemainingPercent({
        fallbackRemainingPercent: 76,
        fallbackResetAt: "2026-04-04T22:00:00.000Z",
        baselineRemainingPercent: 13,
        baselineResetAt: "2026-04-04T22:00:00.000Z",
      }),
    ).toBe(13);
  });

  it("uses newer reset cycle instead of older lower baseline", () => {
    expect(
      selectStableRemainingPercent({
        fallbackRemainingPercent: 96,
        fallbackResetAt: "2026-04-05T03:00:00.000Z",
        baselineRemainingPercent: 13,
        baselineResetAt: "2026-04-04T22:00:00.000Z",
      }),
    ).toBe(96);
  });
});
