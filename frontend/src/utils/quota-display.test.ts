import { describe, expect, it } from "vitest";

import { normalizeRemainingPercentForDisplay } from "@/utils/quota-display";

describe("normalizeRemainingPercentForDisplay", () => {
  it("returns 100 for 5h window when reset is already past", () => {
    const result = normalizeRemainingPercentForDisplay({
      windowKey: "primary",
      remainingPercent: 2,
      resetAt: "2026-01-01T00:00:00.000Z",
      nowMs: new Date("2026-01-01T00:00:01.000Z").getTime(),
    });

    expect(result).toBe(100);
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

  it("keeps original value for weekly window even after reset", () => {
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
});

