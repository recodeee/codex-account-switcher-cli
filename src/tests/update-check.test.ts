import test from "node:test";
import assert from "node:assert/strict";

import {
  formatUpdateSummaryCard,
  formatUpdateSummaryInline,
  getUpdateSummary,
  isVersionNewer,
  parseVersionTriplet,
  shouldProceedWithYesDefault,
} from "../lib/update-check";

test("parseVersionTriplet parses standard semver triplets", () => {
  assert.deepEqual(parseVersionTriplet("0.1.9"), [0, 1, 9]);
  assert.deepEqual(parseVersionTriplet("v1.20.3"), [1, 20, 3]);
});

test("parseVersionTriplet supports pre-release/build suffixes", () => {
  assert.deepEqual(parseVersionTriplet("1.2.3-beta.1"), [1, 2, 3]);
  assert.deepEqual(parseVersionTriplet("1.2.3+build"), [1, 2, 3]);
});

test("parseVersionTriplet rejects non-triplet versions", () => {
  assert.equal(parseVersionTriplet("1.2"), null);
  assert.equal(parseVersionTriplet("latest"), null);
});

test("isVersionNewer compares semver triplets correctly", () => {
  assert.equal(isVersionNewer("0.1.8", "0.1.9"), true);
  assert.equal(isVersionNewer("0.1.9", "0.1.9"), false);
  assert.equal(isVersionNewer("0.2.0", "0.1.9"), false);
});

test("isVersionNewer returns false when either version is invalid", () => {
  assert.equal(isVersionNewer("latest", "0.1.9"), false);
  assert.equal(isVersionNewer("0.1.8", "nightly"), false);
});

test("getUpdateSummary returns update-available state", () => {
  const summary = getUpdateSummary("0.1.8", "0.1.9");
  assert.deepEqual(summary, {
    currentVersion: "0.1.8",
    latestVersion: "0.1.9",
    state: "update-available",
  });
});

test("getUpdateSummary returns up-to-date state", () => {
  const summary = getUpdateSummary("0.1.9", "0.1.9");
  assert.deepEqual(summary, {
    currentVersion: "0.1.9",
    latestVersion: "0.1.9",
    state: "up-to-date",
  });
});

test("formatUpdateSummaryInline renders human-friendly states", () => {
  assert.equal(
    formatUpdateSummaryInline({
      currentVersion: "0.1.8",
      latestVersion: "0.1.9",
      state: "update-available",
    }),
    "⬆ Update available: 0.1.8 -> 0.1.9",
  );
  assert.equal(
    formatUpdateSummaryInline({
      currentVersion: "0.1.9",
      latestVersion: "0.1.9",
      state: "up-to-date",
    }),
    "✓ Up to date: 0.1.9",
  );
});

test("formatUpdateSummaryCard renders a stable 4-line card", () => {
  const lines = formatUpdateSummaryCard({
    currentVersion: "0.1.9",
    latestVersion: "0.1.10",
    state: "update-available",
  });
  assert.equal(lines.length, 4);
  assert.equal(lines[0], "┌─ codex-auth update");
  assert.equal(lines[3], "└─ status : update available");
});

test("shouldProceedWithYesDefault accepts enter and yes responses", () => {
  assert.equal(shouldProceedWithYesDefault(""), true);
  assert.equal(shouldProceedWithYesDefault("   "), true);
  assert.equal(shouldProceedWithYesDefault("y"), true);
  assert.equal(shouldProceedWithYesDefault("Yes"), true);
});

test("shouldProceedWithYesDefault rejects no and unknown responses", () => {
  assert.equal(shouldProceedWithYesDefault("n"), false);
  assert.equal(shouldProceedWithYesDefault("No"), false);
  assert.equal(shouldProceedWithYesDefault("later"), false);
});
