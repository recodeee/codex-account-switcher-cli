import fsp from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";

import {
  fetchLatestNpmVersionCached,
  formatUpdateSummaryCard,
  formatUpdateSummaryInline,
  getUpdateSummary,
  isVersionNewer,
  PACKAGE_NAME,
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

test("fetchLatestNpmVersionCached reuses a fresh cached version", async (t) => {
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-auth-update-check-"));
  const cachePath = path.join(cacheDir, "update-check.json");
  t.after(async () => {
    await fsp.rm(cacheDir, { recursive: true, force: true });
  });

  let fetchCalls = 0;
  const first = await fetchLatestNpmVersionCached(PACKAGE_NAME, {
    cachePath,
    nowMs: 1_000,
    ttlMs: 60_000,
    fetcher: async () => {
      fetchCalls += 1;
      return "0.1.16";
    },
  });
  const second = await fetchLatestNpmVersionCached(PACKAGE_NAME, {
    cachePath,
    nowMs: 1_500,
    ttlMs: 60_000,
    fetcher: async () => {
      fetchCalls += 1;
      return "0.1.17";
    },
  });

  assert.equal(first, "0.1.16");
  assert.equal(second, "0.1.16");
  assert.equal(fetchCalls, 1);
});

test("fetchLatestNpmVersionCached refreshes a stale cache", async (t) => {
  const cacheDir = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-auth-update-check-"));
  const cachePath = path.join(cacheDir, "update-check.json");
  t.after(async () => {
    await fsp.rm(cacheDir, { recursive: true, force: true });
  });

  let fetchCalls = 0;
  await fetchLatestNpmVersionCached(PACKAGE_NAME, {
    cachePath,
    nowMs: 1_000,
    ttlMs: 60_000,
    fetcher: async () => {
      fetchCalls += 1;
      return "0.1.16";
    },
  });
  const refreshed = await fetchLatestNpmVersionCached(PACKAGE_NAME, {
    cachePath,
    nowMs: 70_000,
    ttlMs: 60_000,
    fetcher: async () => {
      fetchCalls += 1;
      return "0.1.17";
    },
  });

  assert.equal(refreshed, "0.1.17");
  assert.equal(fetchCalls, 2);
});
