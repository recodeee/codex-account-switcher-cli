import { describe, expect, it } from "vitest";

import { buildReferralLink } from "@/features/referrals/utils";

describe("buildReferralLink", () => {
  it("creates a stable referral URL from account id", () => {
    const link = buildReferralLink("acc_primary");
    const url = new URL(link);

    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe("/");
    expect(url.searchParams.get("ref")).toBe("acc_primary");
  });
});
