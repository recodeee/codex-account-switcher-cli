import { describe, expect, it } from "vitest";

import { resolveMenuAccountEmail } from "@/components/layout/account-menu";
import { createAccountSummary } from "@/test/mocks/factories";

describe("resolveMenuAccountEmail", () => {
  it("prefers accounts with active CLI session signals", () => {
    const selected = resolveMenuAccountEmail([
      createAccountSummary({
        accountId: "acc_idle",
        email: "idle@example.com",
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "idle",
          activeSnapshotName: "idle",
          isActiveSnapshot: true,
          hasLiveSession: false,
          expectedSnapshotName: "idle",
          snapshotNameMatchesEmail: true,
        },
      }),
      createAccountSummary({
        accountId: "acc_live",
        email: "live@example.com",
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "live",
          activeSnapshotName: "live",
          isActiveSnapshot: true,
          hasLiveSession: true,
          expectedSnapshotName: "live",
          snapshotNameMatchesEmail: true,
        },
      }),
    ]);

    expect(selected).toBe("live@example.com");
  });

  it("falls back to active accounts when no session signals exist", () => {
    const selected = resolveMenuAccountEmail([
      createAccountSummary({
        accountId: "acc_paused",
        email: "paused@example.com",
        status: "paused",
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "paused",
          activeSnapshotName: "paused",
          isActiveSnapshot: false,
          hasLiveSession: false,
          expectedSnapshotName: "paused",
          snapshotNameMatchesEmail: true,
        },
      }),
      createAccountSummary({
        accountId: "acc_active",
        email: "active@example.com",
        status: "active",
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "active",
          activeSnapshotName: "active",
          isActiveSnapshot: true,
          hasLiveSession: false,
          expectedSnapshotName: "active",
          snapshotNameMatchesEmail: true,
        },
      }),
    ]);

    expect(selected).toBe("active@example.com");
  });

  it("returns null when no accounts are available", () => {
    expect(resolveMenuAccountEmail([])).toBeNull();
  });

  it("prioritizes the current active snapshot over non-active live-session accounts", () => {
    const selected = resolveMenuAccountEmail([
      createAccountSummary({
        accountId: "acc_busy",
        email: "busy@example.com",
        codexLiveSessionCount: 3,
        codexTrackedSessionCount: 3,
        codexSessionCount: 3,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "busy",
          activeSnapshotName: "active",
          isActiveSnapshot: false,
          hasLiveSession: true,
          expectedSnapshotName: "busy",
          snapshotNameMatchesEmail: true,
        },
      }),
      createAccountSummary({
        accountId: "acc_active_snapshot",
        email: "nagy.viktordp@gmail.com",
        codexLiveSessionCount: 0,
        codexTrackedSessionCount: 0,
        codexSessionCount: 0,
        codexAuth: {
          hasSnapshot: true,
          snapshotName: "nagy.viktordp@gmail.com",
          activeSnapshotName: "nagy.viktordp@gmail.com",
          isActiveSnapshot: true,
          hasLiveSession: false,
          expectedSnapshotName: "nagy.viktordp@gmail.com",
          snapshotNameMatchesEmail: true,
        },
      }),
    ]);

    expect(selected).toBe("nagy.viktordp@gmail.com");
  });
});
