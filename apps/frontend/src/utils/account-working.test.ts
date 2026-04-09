import { afterEach, describe, expect, it } from "vitest";

import { createAccountSummary } from "@/test/mocks/factories";
import {
  getRecentWorkingNowSignalEntry,
  getWorkingNowUsageLimitHitCountdownMs,
  hasActiveCliSessionSignal,
  hasRecentWorkingNowSignal,
  getMergedQuotaRemainingPercent,
  noteWorkingNowSignal,
  getRawQuotaWindowFallback,
  resetWorkingNowLimitHitStateForTests,
  isAccountWorkingNow,
  selectStableRemainingPercent,
} from "@/utils/account-working";

afterEach(() => {
  resetWorkingNowLimitHitStateForTests();
});

describe("working-now transient signal cache", () => {
  it("reuses recent session counters and last non-waiting preview for short telemetry dips", () => {
    const account = createAccountSummary({
      accountId: "acc_working_cache",
      codexLiveSessionCount: 2,
      codexTrackedSessionCount: 2,
      codexSessionCount: 2,
      codexCurrentTaskPreview: "Waiting for new task",
      codexLastTaskPreview: "Syncing Klara order attribution",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working-cache",
        activeSnapshotName: "working-cache",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });
    const nowMs = new Date("2026-04-09T10:00:00.000Z").getTime();

    noteWorkingNowSignal(account, nowMs);
    const transientEntry = getRecentWorkingNowSignalEntry(account, nowMs + 30_000);

    expect(transientEntry).not.toBeNull();
    expect(transientEntry?.codexLiveSessionCount).toBe(2);
    expect(transientEntry?.codexTrackedSessionCount).toBe(2);
    expect(transientEntry?.codexSessionCount).toBe(2);
    expect(transientEntry?.taskPreview).toBe("Syncing Klara order attribution");
  });

  it("expires the transient signal cache after the grace window", () => {
    const account = createAccountSummary({
      accountId: "acc_working_cache_expire",
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexCurrentTaskPreview: "Refining Zeus task dispatch",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "working-cache-expire",
        activeSnapshotName: "working-cache-expire",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
    });
    const nowMs = new Date("2026-04-09T10:00:00.000Z").getTime();

    noteWorkingNowSignal(account, nowMs);
    expect(hasRecentWorkingNowSignal(account, nowMs + 60_000)).toBe(true);
    expect(getRecentWorkingNowSignalEntry(account, nowMs + 95_000)).toBeNull();
    expect(hasRecentWorkingNowSignal(account, nowMs + 95_000)).toBe(false);
  });
});

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

  it("returns true immediately when live-session startup signal arrives before telemetry timestamps", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 1,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account, now.getTime())).toBe(true);
  });

  it("returns true when a live process session count has fresh telemetry timestamps", () => {
    const now = new Date("2026-04-04T12:00:00.000Z");
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 2,
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:00.000Z",
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account, now.getTime())).toBe(true);
  });

  it("returns false when tracked codex sessions are present without fresh telemetry", () => {
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

    expect(isAccountWorkingNow(account)).toBe(false);
  });

  it("returns true for low-quota accounts when codex snapshot visibility is unavailable", () => {
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 10,
        secondaryRemainingPercent: 56,
      },
      codexAuth: null,
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true for low-quota accounts even when snapshot visibility exists", () => {
    const account = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 10,
        secondaryRemainingPercent: 56,
      },
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "admin",
        activeSnapshotName: "odin",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
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

  it("keeps sub-5% 5h accounts in working-now after grace while CLI signals stay live", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 4,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
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
    expect(isAccountWorkingNow(account, new Date("2026-04-04T12:00:01.000Z").getTime())).toBe(true);
  });

  it("keeps usage-limit-hit accounts in working-now after 60 seconds while CLI signals stay live", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
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
    expect(isAccountWorkingNow(account, new Date("2026-04-04T12:00:01.000Z").getTime())).toBe(true);
  });

  it("allows usage-limit-hit accounts back into working-now after the 5h reset timestamp", () => {
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T12:00:00.000Z",
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
    expect(isAccountWorkingNow(account, new Date("2026-04-04T12:00:01.000Z").getTime())).toBe(true);
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
    expect(countdownMs).toBeGreaterThanOrEqual(59_000);
    expect(countdownMs).toBeLessThanOrEqual(60_000);
  });

  it("does not restart the usage-limit grace window for the same stuck session and keeps working-now active", () => {
    const base = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
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

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    const initialCountdownMs = getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs);
    expect(initialCountdownMs).toBeGreaterThan(0);

    const refreshedButSameSession = {
      ...base,
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:10.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:10.000Z",
    };
    const secondNowMs = new Date("2026-04-04T12:00:10.000Z").getTime();

    expect(getWorkingNowUsageLimitHitCountdownMs(refreshedButSameSession, secondNowMs)).toBe(0);
    expect(isAccountWorkingNow(refreshedButSameSession, secondNowMs)).toBe(true);
    expect(hasActiveCliSessionSignal(refreshedButSameSession, secondNowMs)).toBe(true);
  });

  it("does not restart usage-limit grace when raw rollout source names rotate and keeps working-now active", () => {
    const base = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexCurrentTaskPreview: "Investigate codexina rate-limit aging",
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
            source: "/tmp/rollout-2026-04-04T23-22-15-019d5a60.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:58:30.000Z",
            stale: false,
            primary: { usedPercent: 100, remainingPercent: 0, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 73, remainingPercent: 27, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:30.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:58:30.000Z",
    });

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    const firstCountdownMs = getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs);
    expect(firstCountdownMs).toBeGreaterThan(0);

    const sameSessionWithRotatedSource = {
      ...base,
      liveQuotaDebug: {
        ...base.liveQuotaDebug!,
        rawSamples: [
          {
            source: "/tmp/rollout-2026-04-04T23-23-30-0aaabbbb.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T12:00:10.000Z",
            stale: false,
            primary: { usedPercent: 100, remainingPercent: 0, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 73, remainingPercent: 27, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:10.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:10.000Z",
    };
    const secondNowMs = new Date("2026-04-04T12:00:10.000Z").getTime();

    expect(getWorkingNowUsageLimitHitCountdownMs(sameSessionWithRotatedSource, secondNowMs)).toBe(0);
    expect(isAccountWorkingNow(sameSessionWithRotatedSource, secondNowMs)).toBe(true);
    expect(hasActiveCliSessionSignal(sameSessionWithRotatedSource, secondNowMs)).toBe(true);
  });

  it("does not restart usage-limit grace when live_usage task preview timestamps rotate and keeps working-now active", () => {
    const base = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexCurrentTaskPreview:
        '<live_usage generated_at="2026-04-04T11:58:30.000Z" total_sessions="5" mapped_sessions="1" unattributed_sessions="4">',
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "cica",
        activeSnapshotName: "cica",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:30.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:58:30.000Z",
    });

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    const firstCountdownMs = getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs);
    expect(firstCountdownMs).toBeGreaterThan(0);

    const sameSessionWithRefreshedLiveUsageTask = {
      ...base,
      codexCurrentTaskPreview:
        '<live_usage generated_at="2026-04-04T12:00:10.000Z" total_sessions="5" mapped_sessions="1" unattributed_sessions="4">',
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:10.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:10.000Z",
    };
    const secondNowMs = new Date("2026-04-04T12:00:10.000Z").getTime();

    expect(
      getWorkingNowUsageLimitHitCountdownMs(
        sameSessionWithRefreshedLiveUsageTask,
        secondNowMs,
      ),
    ).toBe(0);
    expect(
      isAccountWorkingNow(
        sameSessionWithRefreshedLiveUsageTask,
        secondNowMs,
      ),
    ).toBe(true);
    expect(
      hasActiveCliSessionSignal(
        sameSessionWithRefreshedLiveUsageTask,
        secondNowMs,
      ),
    ).toBe(true);
  });

  it("keeps usage-limit countdown at 0 after expiry even if session fingerprint changes", () => {
    const base = createAccountSummary({
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexCurrentTaskPreview: "Investigate quota termination behavior",
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

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    const firstCountdownMs = getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs);
    expect(firstCountdownMs).toBeGreaterThan(0);

    const changedFingerprintAfterExpiry = {
      ...base,
      codexCurrentTaskPreview: "Different task preview after session recycle",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:10.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:10.000Z",
    };
    const secondNowMs = new Date("2026-04-04T12:00:10.000Z").getTime();

    expect(
      getWorkingNowUsageLimitHitCountdownMs(
        changedFingerprintAfterExpiry,
        secondNowMs,
      ),
    ).toBe(0);
  });

  it("isolates usage-limit grace by snapshot when account ids are shared", () => {
    const sharedAccountBase = createAccountSummary({
      accountId: "acc-shared",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "alpha",
        activeSnapshotName: "alpha",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T11:58:30.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T11:58:30.000Z",
    });

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    expect(
      getWorkingNowUsageLimitHitCountdownMs(sharedAccountBase, firstNowMs),
    ).toBeGreaterThan(0);

    const afterFirstGraceMs = new Date("2026-04-04T12:00:10.000Z").getTime();
    expect(
      getWorkingNowUsageLimitHitCountdownMs(sharedAccountBase, afterFirstGraceMs),
    ).toBe(0);

    const secondSnapshotSameAccountId = {
      ...sharedAccountBase,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "beta",
        activeSnapshotName: "beta",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:11.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:11.000Z",
    };
    const secondNowMs = new Date("2026-04-04T12:00:11.000Z").getTime();

    expect(
      getWorkingNowUsageLimitHitCountdownMs(
        secondSnapshotSameAccountId,
        secondNowMs,
      ),
    ).toBeGreaterThan(0);
  });

  it("drops working-now after grace expiry when only stale hasLiveSession remains", () => {
    const base = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs)).toBeGreaterThan(0);
    expect(isAccountWorkingNow(base, firstNowMs)).toBe(true);

    const afterGraceMs = new Date("2026-04-04T12:00:10.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, afterGraceMs)).toBe(0);
    expect(hasActiveCliSessionSignal(base, afterGraceMs)).toBe(true);
    expect(isAccountWorkingNow(base, afterGraceMs)).toBe(false);
  });

  it("does not restart usage-limit grace after a transient no-signal gap once fresh session evidence returns", () => {
    const base = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 1,
      codexSessionCount: 1,
      codexCurrentTaskPreview: "Investigate quota termination behavior",
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

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs)).toBeGreaterThan(0);

    const afterGraceMs = new Date("2026-04-04T12:00:10.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, afterGraceMs)).toBe(0);

    const noSignalGap = {
      ...base,
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    };
    expect(hasActiveCliSessionSignal(noSignalGap, afterGraceMs + 500)).toBe(false);

    const resumedSameCycle = {
      ...base,
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: "2026-04-04T12:00:20.000Z",
      lastUsageRecordedAtSecondary: "2026-04-04T12:00:20.000Z",
    };
    const resumedNowMs = new Date("2026-04-04T12:00:20.000Z").getTime();

    expect(getWorkingNowUsageLimitHitCountdownMs(resumedSameCycle, resumedNowMs)).toBe(0);
    expect(isAccountWorkingNow(resumedSameCycle, resumedNowMs)).toBe(true);
  });

  it("drops working-now after grace once session task previews report terminal errors", () => {
    const base = createAccountSummary({
      status: "active",
      usage: {
        primaryRemainingPercent: 0,
        secondaryRemainingPercent: 88,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "sess-error",
          taskPreview: "Task failed: command exited with code 1",
          taskUpdatedAt: "2026-04-04T11:59:30.000Z",
        },
      ],
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });

    const firstNowMs = new Date("2026-04-04T11:59:00.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, firstNowMs)).toBeGreaterThan(0);

    const afterGraceMs = new Date("2026-04-04T12:00:10.000Z").getTime();
    expect(getWorkingNowUsageLimitHitCountdownMs(base, afterGraceMs)).toBe(0);
    expect(hasActiveCliSessionSignal(base, afterGraceMs)).toBe(true);
    expect(isAccountWorkingNow(base, afterGraceMs)).toBe(false);
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

  it("drops no-live-telemetry accounts when scoped cli samples are missing", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "no cli sessions sampled should not keep working-now",
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "itrexsale",
        activeSnapshotName: "codexina",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["itrexsale"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-codexina.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:59:00.000Z",
            stale: false,
            primary: { usedPercent: 56, remainingPercent: 44, resetAt: 1760000000, windowMinutes: 300 },
            secondary: { usedPercent: 40, remainingPercent: 60, resetAt: 1760600000, windowMinutes: 10080 },
          },
        ],
      },
    });

    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
  });

  it("returns false for active snapshot live sessions when telemetry samples are missing", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "codexina",
        activeSnapshotName: "codexina",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["codexina"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
  });

  it("returns true when live process session count is present during no-live-telemetry startup gaps", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "planning",
        activeSnapshotName: "other",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["planning"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
    expect(isAccountWorkingNow(account, nowMs)).toBe(true);
  });

  it("returns true when active snapshot has a fresh session task preview during no-live-telemetry gaps", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "pid:4242",
          taskPreview: "Re-activate the old removed card for pia@edix.hu",
          taskUpdatedAt: "2026-04-04T11:58:45.000Z",
        },
      ],
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "pia-edix",
        activeSnapshotName: "pia-edix",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["pia-edix"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
    expect(isAccountWorkingNow(account, nowMs)).toBe(true);
  });

  it("keeps working-now when recent non-terminal session rows remain visible during no-live-telemetry gaps", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "pid:9001",
          taskPreview: "Waiting for new task",
          taskUpdatedAt: "2026-04-04T11:15:00.000Z",
        },
      ],
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "zeus",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
    expect(isAccountWorkingNow(account, nowMs)).toBe(true);
  });

  it("drops working-now when session rows are older than the long preview grace window", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "pid:9002",
          taskPreview: "Waiting for new task",
          taskUpdatedAt: "2026-04-04T08:00:00.000Z",
        },
      ],
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "zeus",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(false);
    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
  });

  it("returns false when compatibility codexSessionCount is present without fresh telemetry", () => {
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

    expect(isAccountWorkingNow(account)).toBe(false);
  });

  it("returns false when only deferred mixed-default raw samples exist without active session signals", () => {
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
    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
  });

  it("returns true for deferred mixed-default samples when a current task preview is present", () => {
    const account = createAccountSummary({
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "Investigate session attribution for edixai runtime",
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

  it("returns true when fresh non-deferred raw samples exist", () => {
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
        overrideReason: "missing_live_usage_payload",
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

  it("ignores merged quotas when backend flags another account as the confident live-usage owner", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        expectedSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "live_usage_confident_match_other_account",
        merged: {
          source: "merged",
          snapshotName: "odin",
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

  it("drops working-now status when telemetry is confidently attributed to another account", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        expectedSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 4,
      codexTrackedSessionCount: 4,
      codexSessionCount: 4,
      codexCurrentTaskPreview: "Investigate admin account session attribution",
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "live_usage_confident_match_other_account",
        merged: {
          source: "merged",
          snapshotName: "odin",
          recordedAt: "2026-04-04T11:58:00.000Z",
          stale: false,
          primary: { usedPercent: 84, remainingPercent: 16, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 10, remainingPercent: 90, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });

    expect(isAccountWorkingNow(account, nowMs)).toBe(false);
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

  it("keeps merged-depleted 5h accounts in working-now after grace while CLI signals stay live", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const nowIso = new Date(nowMs).toISOString();
    const account = createAccountSummary({
      usage: {
        primaryRemainingPercent: 44,
        secondaryRemainingPercent: 90,
      },
      resetAtPrimary: "2026-04-04T14:30:00.000Z",
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
      lastUsageRecordedAtPrimary: nowIso,
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

    expect(isAccountWorkingNow(account, nowMs)).toBe(true);
    expect(isAccountWorkingNow(account, nowMs + 61_000)).toBe(true);
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

describe("hasActiveCliSessionSignal", () => {
  it("follows the locked detection cascade order", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();

    const authLive = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(authLive, nowMs)).toBe(true);

    const freshTelemetry = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 1,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: "2026-04-04T11:59:00.000Z",
      lastUsageRecordedAtSecondary: null,
    });
    expect(hasActiveCliSessionSignal(freshTelemetry, nowMs)).toBe(true);

    const trackedOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 2,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
    });
    expect(hasActiveCliSessionSignal(trackedOnly, nowMs)).toBe(true);

    const taskPreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "Trace startup session detection lag",
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(taskPreviewOnly, nowMs)).toBe(true);

    const sessionTaskPreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-1",
          taskPreview: "Investigate admin account session attribution",
          taskUpdatedAt: "2026-04-04T11:59:00.000Z",
        },
      ],
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(sessionTaskPreviewOnly, nowMs)).toBe(true);

    const staleSessionTaskPreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-1",
          taskPreview: "Investigate admin account session attribution",
          taskUpdatedAt: "2026-04-04T03:40:00.000Z",
        },
      ],
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(staleSessionTaskPreviewOnly, nowMs)).toBe(true);

    const finishedSessionTaskPreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: null,
      codexSessionTaskPreviews: [
        {
          sessionKey: "session-1",
          taskPreview: "Task finished",
          taskUpdatedAt: "2026-04-04T11:59:00.000Z",
        },
      ],
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(finishedSessionTaskPreviewOnly, nowMs)).toBe(false);

    const warningPreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview:
        "Warning: apply_patch was requested via exec_command. Use the apply_patch tool instead of exec_command.",
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(warningPreviewOnly, nowMs)).toBe(false);

    const donePreviewOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "Task is done already.",
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "none",
        merged: null,
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(donePreviewOnly, nowMs)).toBe(false);

    const confidentOtherAccountMatch = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "odin",
        activeSnapshotName: "odin",
        expectedSnapshotName: "odin",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 4,
      codexTrackedSessionCount: 4,
      codexSessionCount: 4,
      codexCurrentTaskPreview: "Investigate admin account session attribution",
      liveQuotaDebug: {
        snapshotsConsidered: ["odin"],
        overrideApplied: false,
        overrideReason: "live_usage_confident_match_other_account",
        merged: {
          source: "merged",
          snapshotName: "odin",
          recordedAt: "2026-04-04T11:58:00.000Z",
          stale: false,
          primary: { usedPercent: 84, remainingPercent: 16, resetAt: 1760000000, windowMinutes: 300 },
          secondary: { usedPercent: 10, remainingPercent: 90, resetAt: 1760600000, windowMinutes: 10080 },
        },
        rawSamples: [],
      },
    });
    expect(hasActiveCliSessionSignal(confidentOtherAccountMatch, nowMs)).toBe(false);

    const debugOnly = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["main"],
        overrideApplied: false,
        overrideReason: "missing_live_usage_payload",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-main.jsonl",
            snapshotName: "main",
            recordedAt: "2026-04-04T11:58:00.000Z",
            stale: false,
            primary: {
              usedPercent: 44,
              remainingPercent: 56,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 22,
              remainingPercent: 78,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });
    expect(hasActiveCliSessionSignal(debugOnly, nowMs)).toBe(true);
  });

  it("returns true for no-live-telemetry when snapshot has live-session signal but scoped samples are missing", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "itrexsale",
        activeSnapshotName: "codexina",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      codexCurrentTaskPreview: "keep only real cli sessions in working now",
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["itrexsale"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [
          {
            source: "/tmp/rollout-codexina.jsonl",
            snapshotName: "codexina",
            recordedAt: "2026-04-04T11:58:00.000Z",
            stale: false,
            primary: {
              usedPercent: 44,
              remainingPercent: 56,
              resetAt: 1760000000,
              windowMinutes: 300,
            },
            secondary: {
              usedPercent: 22,
              remainingPercent: 78,
              resetAt: 1760600000,
              windowMinutes: 10080,
            },
          },
        ],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
  });

  it("keeps active snapshot live sessions visible when no-live-telemetry samples are missing", () => {
    const nowMs = new Date("2026-04-04T12:00:00.000Z").getTime();
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "codexina",
        activeSnapshotName: "codexina",
        isActiveSnapshot: true,
        hasLiveSession: true,
      },
      codexLiveSessionCount: 0,
      codexTrackedSessionCount: 0,
      codexSessionCount: 0,
      lastUsageRecordedAtPrimary: null,
      lastUsageRecordedAtSecondary: null,
      liveQuotaDebug: {
        snapshotsConsidered: ["codexina"],
        overrideApplied: false,
        overrideReason: "no_live_telemetry",
        merged: null,
        rawSamples: [],
      },
    });

    expect(hasActiveCliSessionSignal(account, nowMs)).toBe(true);
  });
});
