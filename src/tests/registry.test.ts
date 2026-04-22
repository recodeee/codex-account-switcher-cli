import test from "node:test";
import assert from "node:assert/strict";
import { reconcileRegistryWithAccounts, sanitizeRegistry } from "../lib/accounts/registry";

test("sanitizeRegistry falls back to defaults for invalid thresholds", () => {
  const registry = sanitizeRegistry({
    autoSwitch: {
      enabled: true,
      threshold5hPercent: 0,
      thresholdWeeklyPercent: 101,
    },
    api: {
      usage: false,
    },
    accounts: {},
  });

  assert.equal(registry.autoSwitch.enabled, true);
  assert.equal(registry.autoSwitch.threshold5hPercent, 10);
  assert.equal(registry.autoSwitch.thresholdWeeklyPercent, 5);
  assert.equal(registry.api.usage, false);
});

test("reconcileRegistryWithAccounts drops missing account entries", () => {
  const registry = sanitizeRegistry({
    accounts: {
      keep: { name: "keep", createdAt: new Date().toISOString() },
      remove: { name: "remove", createdAt: new Date().toISOString() },
    },
    activeAccountName: "remove",
  });

  const reconciled = reconcileRegistryWithAccounts(registry, ["keep"]);
  assert.deepEqual(Object.keys(reconciled.accounts), ["keep"]);
  assert.equal(reconciled.activeAccountName, undefined);
});
