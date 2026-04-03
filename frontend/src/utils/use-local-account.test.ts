import { describe, expect, it } from "vitest";

import { canUseLocalAccount, getUseLocalAccountDisabledReason } from "@/utils/use-local-account";

describe("use-local account gating", () => {
  it("allows local switch only for active status with at least 1% 5h quota", () => {
    expect(canUseLocalAccount({ status: "active", primaryRemainingPercent: 1 })).toBe(true);
    expect(canUseLocalAccount({ status: "active", primaryRemainingPercent: 0.99 })).toBe(false);
    expect(canUseLocalAccount({ status: "paused", primaryRemainingPercent: 44 })).toBe(false);
    expect(canUseLocalAccount({ status: "rate_limited", primaryRemainingPercent: 44 })).toBe(false);
    expect(canUseLocalAccount({ status: "quota_exceeded", primaryRemainingPercent: 44 })).toBe(false);
    expect(canUseLocalAccount({ status: "deactivated", primaryRemainingPercent: 44 })).toBe(false);
    expect(
      canUseLocalAccount({
        status: "deactivated",
        primaryRemainingPercent: 44,
        isActiveSnapshot: true,
      }),
    ).toBe(true);
    expect(
      canUseLocalAccount({
        status: "deactivated",
        primaryRemainingPercent: 44,
        hasLiveSession: true,
      }),
    ).toBe(true);
    expect(canUseLocalAccount({ status: "active", primaryRemainingPercent: 0 })).toBe(false);
    expect(canUseLocalAccount({ status: "active", primaryRemainingPercent: null })).toBe(false);
  });

  it("returns status-first disabled reasons", () => {
    expect(
      getUseLocalAccountDisabledReason({ status: "deactivated", primaryRemainingPercent: 44 }),
    ).toBe("Account must be active.");
    expect(
      getUseLocalAccountDisabledReason({
        status: "deactivated",
        primaryRemainingPercent: 44,
        isActiveSnapshot: true,
      }),
    ).toBeNull();
    expect(
      getUseLocalAccountDisabledReason({
        status: "deactivated",
        primaryRemainingPercent: 44,
        hasLiveSession: true,
      }),
    ).toBeNull();
    expect(
      getUseLocalAccountDisabledReason({ status: "active", primaryRemainingPercent: 0 }),
    ).toBe("Need at least 1% 5h quota remaining.");
    expect(
      getUseLocalAccountDisabledReason({ status: "active", primaryRemainingPercent: 44 }),
    ).toBeNull();
  });
});
