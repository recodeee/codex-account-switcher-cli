import { describe, expect, it } from "vitest";

import { resolveEffectiveAccountStatus } from "@/utils/account-status";

describe("resolveEffectiveAccountStatus", () => {
  it("keeps legacy deactivated override behavior by default", () => {
    expect(
      resolveEffectiveAccountStatus({
        status: "deactivated",
        hasSnapshot: true,
      }),
    ).toBe("active");
  });

  it("supports disabling deactivated override for UI status badges", () => {
    expect(
      resolveEffectiveAccountStatus({
        status: "deactivated",
        hasSnapshot: true,
        isActiveSnapshot: true,
        hasLiveSession: true,
        hasRecentUsageSignal: true,
        allowDeactivatedOverride: false,
      }),
    ).toBe("deactivated");
  });
});
