import { describe, expect, it } from "vitest";

import { createAccountSummary } from "@/test/mocks/factories";
import { isAccountWorkingNow } from "@/utils/account-working";

describe("isAccountWorkingNow", () => {
  it("returns true when codex auth reports a live session", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: true,
      },
      codexSessionCount: 0,
    });
    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true when account is active snapshot", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "main",
        activeSnapshotName: "main",
        isActiveSnapshot: true,
        hasLiveSession: false,
      },
      codexSessionCount: 0,
    });
    expect(isAccountWorkingNow(account)).toBe(true);
  });

  it("returns true when account has tracked codex sessions", () => {
    const account = createAccountSummary({
      codexAuth: {
        hasSnapshot: true,
        snapshotName: "secondary",
        activeSnapshotName: "main",
        isActiveSnapshot: false,
        hasLiveSession: false,
      },
      codexSessionCount: 2,
    });
    expect(isAccountWorkingNow(account)).toBe(true);
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
      codexSessionCount: 0,
    });
    expect(isAccountWorkingNow(account)).toBe(false);
  });
});

