import { beforeEach, describe, expect, it } from "vitest";

import {
  normalizeRemainingPercentForDisplay,
  resetQuotaDisplayFloorCacheForAccount,
  resetQuotaDisplayFloorCacheForTests,
} from "@/utils/quota-display";

describe("normalizeRemainingPercentForDisplay", () => {
  beforeEach(() => {
    resetQuotaDisplayFloorCacheForTests();
  });

  it("keeps original value for 5h window when reset is already past", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: 2,
      resetAt: "2026-01-01T00:00:00.000Z",
      nowMs: new Date("2026-01-01T00:00:01.000Z").getTime(),
    });

    expect(result).toBe(2);
  });

  it("keeps original value for 5h window before reset", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: 2,
      resetAt: "2026-01-01T00:10:00.000Z",
      nowMs: new Date("2026-01-01T00:00:01.000Z").getTime(),
    });

    expect(result).toBe(2);
  });

  it("keeps original value for weekly window", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "secondary",
      remainingPercent: 88,
      resetAt: "2026-01-01T00:00:00.000Z",
      nowMs: new Date("2026-01-01T00:00:01.000Z").getTime(),
    });

    expect(result).toBe(88);
  });

  it("keeps null values as null", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: null,
      resetAt: "2026-01-01T00:00:00.000Z",
      nowMs: new Date("2026-01-01T00:00:01.000Z").getTime(),
    });

    expect(result).toBeNull();
  });

  it("hides live quota values when telemetry timestamp is stale", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: 97,
      resetAt: "2026-01-01T02:00:00.000Z",
      hasLiveSession: true,
      lastRecordedAt: "2026-01-01T00:00:00.000Z",
      nowMs: new Date("2026-01-01T00:10:00.000Z").getTime(),
    });

    expect(result).toBeNull();
  });

  it("keeps live quota values when telemetry timestamp is fresh", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: 77,
      resetAt: "2026-01-01T02:00:00.000Z",
      hasLiveSession: true,
      lastRecordedAt: "2026-01-01T00:09:00.000Z",
      nowMs: new Date("2026-01-01T00:10:00.000Z").getTime(),
    });

    expect(result).toBe(77);
  });

  it("hides live quota values when timestamp is missing", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "secondary",
      remainingPercent: 47,
      resetAt: "2026-01-07T02:00:00.000Z",
      hasLiveSession: true,
      lastRecordedAt: null,
      nowMs: new Date("2026-01-01T00:10:00.000Z").getTime(),
    });

    expect(result).toBeNull();
  });

  it("keeps the lowest remaining value per account/window within the same reset cycle", () => {
    const first = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 98,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:00:00.000Z").getTime(),
    });
    const second = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 58,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:10:00.000Z").getTime(),
    });
    const third = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 79,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:20:00.000Z").getTime(),
    });

    expect(first).toBe(98);
    expect(second).toBe(58);
    expect(third).toBe(58);
  });

  it("allows higher values again after reset cycle changes", () => {
    const first = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 17,
      resetAt: "2026-01-01T05:00:00.000Z",
    });
    const second = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 92,
      resetAt: "2026-01-01T10:00:00.000Z",
    });

    expect(first).toBe(17);
    expect(second).toBe(92);
  });

  it("allows higher values once reset time passes, even before resetAt rotates", () => {
    const first = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 17,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:59:00.000Z").getTime(),
    });
    const second = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 95,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T05:01:00.000Z").getTime(),
    });

    expect(first).toBe(17);
    expect(second).toBe(95);
  });

  it("tracks floor independently for each account and window", () => {
    const accountOnePrimary = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 35,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:00:00.000Z").getTime(),
    });
    const accountOneWeekly = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "secondary",
      remainingPercent: 75,
      resetAt: "2026-01-07T00:00:00.000Z",
      nowMs: new Date("2026-01-01T04:00:00.000Z").getTime(),
    });
    const accountTwoPrimary = normalizeRemainingPercentForDisplay({
      accountKey: "acc-2",
      windowKey: "primary",
      remainingPercent: 90,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:00:00.000Z").getTime(),
    });
    const accountOnePrimaryAfterHigher = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "primary",
      remainingPercent: 65,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:30:00.000Z").getTime(),
    });
    const accountOneWeeklyAfterLower = normalizeRemainingPercentForDisplay({
      accountKey: "acc-1",
      windowKey: "secondary",
      remainingPercent: 70,
      resetAt: "2026-01-07T00:00:00.000Z",
      nowMs: new Date("2026-01-01T04:45:00.000Z").getTime(),
    });

    expect(accountOnePrimary).toBe(35);
    expect(accountOneWeekly).toBe(75);
    expect(accountTwoPrimary).toBe(90);
    expect(accountOnePrimaryAfterHigher).toBe(35);
    expect(accountOneWeeklyAfterLower).toBe(70);
  });

  it("can bypass cycle floor when authoritative merged values are provided", () => {
    const first = normalizeRemainingPercentForDisplay({
      accountKey: "acc-merged",
      windowKey: "secondary",
      remainingPercent: 0,
      resetAt: "2026-01-07T00:00:00.000Z",
      nowMs: new Date("2026-01-01T04:00:00.000Z").getTime(),
    });
    const second = normalizeRemainingPercentForDisplay({
      accountKey: "acc-merged",
      windowKey: "secondary",
      remainingPercent: 69,
      resetAt: "2026-01-07T00:00:00.000Z",
      nowMs: new Date("2026-01-01T04:10:00.000Z").getTime(),
      applyCycleFloor: false,
    });

    expect(first).toBe(0);
    expect(second).toBe(69);
  });

  it("allows a fresh reading after clearing cache for switched account", () => {
    const first = normalizeRemainingPercentForDisplay({
      accountKey: "acc-switch",
      windowKey: "primary",
      remainingPercent: 10,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:10:00.000Z").getTime(),
    });

    resetQuotaDisplayFloorCacheForAccount("acc-switch");

    const second = normalizeRemainingPercentForDisplay({
      accountKey: "acc-switch",
      windowKey: "primary",
      remainingPercent: 96,
      resetAt: "2026-01-01T05:00:00.000Z",
      nowMs: new Date("2026-01-01T04:12:00.000Z").getTime(),
    });

    expect(first).toBe(10);
    expect(second).toBe(96);
  });
});
