import { describe, expect, it } from "vitest";

import { createAccountSummary } from "@/test/mocks/factories";
import {
  getMergedQuotaRemainingPercent,
  getRawQuotaWindowFallback,
  isAccountWorkingNow,
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

  it("returns false when 5h is depleted even if tracked sessions are present", () => {
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

    expect(isAccountWorkingNow(account, new Date("2026-04-04T12:00:00.000Z").getTime())).toBe(false);
  });

  it("returns false when 5h rounds down to 0% even if live session telemetry is present", () => {
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

    expect(isAccountWorkingNow(account, new Date("2026-04-04T12:00:00.000Z").getTime())).toBe(false);
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

  it("returns true when fresh debug raw samples exist", () => {
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
      lastUsageRecordedAtPrimary: "2026-04-04T11:45:00.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:40:00.000Z",
    });
    expect(isAccountWorkingNow(account, now.getTime())).toBe(false);
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
});
