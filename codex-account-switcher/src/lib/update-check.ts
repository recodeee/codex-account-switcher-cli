import { spawn } from "node:child_process";

const SEMVER_TRIPLET = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
export const PACKAGE_NAME = "@imdeadpool/codex-account-switcher";

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
