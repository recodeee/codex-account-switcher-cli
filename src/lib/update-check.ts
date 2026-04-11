import { spawn } from "node:child_process";

const SEMVER_TRIPLET = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
export const PACKAGE_NAME = "@imdeadpool/codex-account-switcher";
export type UpdateState = "update-available" | "up-to-date" | "unknown";

export interface UpdateSummary {
  currentVersion: string;
  latestVersion: string;
  state: UpdateState;
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

export function shouldProceedWithYesDefault(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized === "y" || normalized === "yes") return true;
  if (normalized === "n" || normalized === "no") return false;
  return false;
}

export async function fetchLatestNpmVersion(packageName: string, timeoutMs = 2_500): Promise<string | null> {
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

export async function runGlobalNpmInstall(
  packageName: string,
  version: "latest" | string = "latest",
): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn("npm", ["i", "-g", `${packageName}@${version}`], {
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
