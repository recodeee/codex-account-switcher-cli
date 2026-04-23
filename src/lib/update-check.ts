import fsp from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveAccountsDir } from "./config/paths";

const SEMVER_TRIPLET = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
const DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 2_500;
const DEFAULT_UPDATE_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
export const PACKAGE_NAME = "@imdeadpool/codex-account-switcher";
export type UpdateState = "update-available" | "up-to-date" | "unknown";
type FetchLatestVersionFn = (packageName: string, timeoutMs?: number) => Promise<string | null>;

export interface UpdateSummary {
  currentVersion: string;
  latestVersion: string;
  state: UpdateState;
}

interface UpdateCheckCacheRecord {
  version: 1;
  packageName: string;
  latestVersion: string;
  checkedAt: number;
}

export interface CachedUpdateCheckOptions {
  cachePath?: string;
  fetcher?: FetchLatestVersionFn;
  nowMs?: number;
  timeoutMs?: number;
  ttlMs?: number;
}

function resolveUpdateCheckCachePath(): string {
  return path.join(resolveAccountsDir(), "update-check.json");
}

async function loadUpdateCheckCache(cachePath: string): Promise<UpdateCheckCacheRecord | null> {
  try {
    const raw = await fsp.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;

    const root = parsed as Record<string, unknown>;
    if (root.version !== 1) return null;
    if (typeof root.packageName !== "string" || !root.packageName.trim()) return null;
    if (typeof root.latestVersion !== "string" || !root.latestVersion.trim()) return null;
    if (typeof root.checkedAt !== "number" || !Number.isFinite(root.checkedAt)) return null;

    return {
      version: 1,
      packageName: root.packageName.trim(),
      latestVersion: root.latestVersion.trim(),
      checkedAt: Math.round(root.checkedAt),
    };
  } catch {
    return null;
  }
}

async function saveUpdateCheckCache(cachePath: string, record: UpdateCheckCacheRecord): Promise<void> {
  try {
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  } catch {
    // Best-effort cache only.
  }
}

export function parseVersionTriplet(version: string): [number, number, number] | null {
  const match = version.trim().match(SEMVER_TRIPLET);
  if (!match) return null;

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isVersionNewer(currentVersion: string, latestVersion: string): boolean {
  const current = parseVersionTriplet(currentVersion);
  const latest = parseVersionTriplet(latestVersion);
  if (!current || !latest) return false;

  for (let i = 0; i < 3; i += 1) {
    if (latest[i] > current[i]) return true;
    if (latest[i] < current[i]) return false;
  }

  return false;
}

export function getUpdateSummary(currentVersion: string, latestVersion: string): UpdateSummary {
  const current = parseVersionTriplet(currentVersion);
  const latest = parseVersionTriplet(latestVersion);
  if (!current || !latest) {
    return {
      currentVersion,
      latestVersion,
      state: "unknown",
    };
  }

  return {
    currentVersion,
    latestVersion,
    state: isVersionNewer(currentVersion, latestVersion) ? "update-available" : "up-to-date",
  };
}

export function formatUpdateSummaryCard(summary: UpdateSummary): string[] {
  const statusLabel =
    summary.state === "update-available"
      ? "update available"
      : summary.state === "up-to-date"
        ? "up to date"
        : "unknown";

  return [
    "┌─ codex-auth update",
    `│  current: ${summary.currentVersion}`,
    `│  latest : ${summary.latestVersion}`,
    `└─ status : ${statusLabel}`,
  ];
}

export function formatUpdateSummaryInline(summary: UpdateSummary): string {
  if (summary.state === "update-available") {
    return `⬆ Update available: ${summary.currentVersion} -> ${summary.latestVersion}`;
  }

  if (summary.state === "up-to-date") {
    return `✓ Up to date: ${summary.currentVersion}`;
  }

  return `ℹ Update status unknown (current: ${summary.currentVersion}, latest: ${summary.latestVersion})`;
}

function normalizeInstallVersion(version: "latest" | string = "latest"): string {
  const trimmed = version.trim();
  return trimmed.length > 0 ? trimmed : "latest";
}

export function formatGlobalInstallSpec(
  packageName: string,
  version: "latest" | string = "latest",
): string {
  return `${packageName}@${normalizeInstallVersion(version)}`;
}

export function formatGlobalInstallCommand(
  packageName: string,
  version: "latest" | string = "latest",
): string {
  return `npm i -g ${formatGlobalInstallSpec(packageName, version)}`;
}

export function formatUpdateCompletedMessage(version: string): string {
  return `✓ Global update completed (installed ${normalizeInstallVersion(version)}).`;
}

export function shouldProceedWithYesDefault(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "y" || normalized === "yes") return true;
  if (normalized === "n" || normalized === "no") return false;
  return false;
}

export async function fetchLatestNpmVersion(
  packageName: string,
  timeoutMs = DEFAULT_UPDATE_CHECK_TIMEOUT_MS,
): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["view", packageName, "version", "--json"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    let output = "";
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      output += chunk.toString();
    });

    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });

    child.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        resolve(null);
        return;
      }

      const trimmed = output.trim();
      if (!trimmed) {
        resolve(null);
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (typeof parsed === "string" && parsed.trim().length > 0) {
          resolve(parsed.trim());
          return;
        }
      } catch {
        // fall through
      }

      resolve(trimmed.replace(/^"+|"+$/g, ""));
    });
  });
}

export async function fetchLatestNpmVersionCached(
  packageName: string,
  options: CachedUpdateCheckOptions = {},
): Promise<string | null> {
  const cachePath = options.cachePath ?? resolveUpdateCheckCachePath();
  const ttlMs = options.ttlMs ?? DEFAULT_UPDATE_CACHE_TTL_MS;
  const nowMs = options.nowMs ?? Date.now();
  const cached = await loadUpdateCheckCache(cachePath);

  if (
    cached &&
    cached.packageName === packageName &&
    nowMs - cached.checkedAt >= 0 &&
    nowMs - cached.checkedAt <= ttlMs
  ) {
    return cached.latestVersion;
  }

  const fetcher = options.fetcher ?? fetchLatestNpmVersion;
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const latestVersion = await fetcher(packageName, timeoutMs);
  if (latestVersion) {
    await saveUpdateCheckCache(cachePath, {
      version: 1,
      packageName,
      latestVersion,
      checkedAt: nowMs,
    });
    return latestVersion;
  }

  if (cached && cached.packageName === packageName) {
    return cached.latestVersion;
  }

  return null;
}

export async function runGlobalNpmInstall(
  packageName: string,
  version: "latest" | string = "latest",
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["i", "-g", formatGlobalInstallSpec(packageName, version)], {
      stdio: "inherit",
    });

    child.on("error", () => {
      resolve(1);
    });

    child.on("exit", (code) => {
      resolve(typeof code === "number" ? code : 1);
    });
  });
}
