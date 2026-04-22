import test from "node:test";
import assert from "node:assert/strict";
import { shouldSwitchCurrent, usageScore } from "../lib/accounts/usage";
import type { UsageSnapshot } from "../lib/accounts/types";

const nowSeconds = Math.floor(Date.now() / 1000);

test("usageScore uses min remaining window percent", () => {
  const usage: UsageSnapshot = {
    source: "api",
    fetchedAt: new Date().toISOString(),
    primary: { usedPercent: 30, windowMinutes: 300, resetsAt: nowSeconds + 60 },
    secondary: { usedPercent: 10, windowMinutes: 10080, resetsAt: nowSeconds + 60 },
  };

  assert.equal(usageScore(usage, nowSeconds), 70);
});

test("shouldSwitchCurrent triggers when 5h threshold crossed", () => {
  const usage: UsageSnapshot = {
    source: "api",
    fetchedAt: new Date().toISOString(),
    primary: { usedPercent: 96, windowMinutes: 300, resetsAt: nowSeconds + 60 },
  };

  assert.equal(
    shouldSwitchCurrent(
      usage,
      {
        threshold5hPercent: 10,
        thresholdWeeklyPercent: 5,
      },
      nowSeconds,
    ),
    true,
  );
});
