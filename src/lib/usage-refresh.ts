/**
 * Live usage refresh — fetches quota/usage from ChatGPT API.
 * Ported from Loongphy/agent-auth usage refresh logic.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 5000;
const ACCOUNTS_DIR = path.join(os.homedir(), ".codex", "accounts");

export interface UsageData {
  primary?: { remainingPercent: number; resetsAt?: string };
  secondary?: { remainingPercent: number; resetsAt?: string };
  planType?: string;
  fetchedAt: string;
}

function extractAccessToken(snapshotPath: string): string | undefined {
  try {
    const data = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    return data?.tokens?.accessToken;
  } catch {
    return undefined;
  }
}

export async function fetchUsage(accountName: string): Promise<UsageData | undefined> {
  const snapshotPath = path.join(ACCOUNTS_DIR, `${accountName}.json`);
  const token = extractAccessToken(snapshotPath);
  if (!token) return undefined;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const res = await fetch(USAGE_ENDPOINT, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) return undefined;

    const body = await res.json() as Record<string, unknown>;
    const windows = body.rate_limits as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(windows)) return undefined;

    const result: UsageData = { fetchedAt: new Date().toISOString() };

    for (const w of windows) {
      const remaining = typeof w.remaining === "number" ? w.remaining : undefined;
      const limit = typeof w.limit === "number" ? w.limit : undefined;
      const resetsAt = typeof w.resets_at === "string" ? w.resets_at : undefined;
      const windowMinutes = typeof w.window_minutes === "number" ? w.window_minutes : undefined;

      if (remaining === undefined || limit === undefined || limit === 0) continue;
      const pct = Math.round((remaining / limit) * 100);

      if (windowMinutes && windowMinutes <= 300) {
        result.primary = { remainingPercent: pct, resetsAt };
      } else {
        result.secondary = { remainingPercent: pct, resetsAt };
      }
    }

    return result;
  } catch {
    return undefined;
  }
}

export function formatUsageCell(pct: number | undefined): string {
  if (pct === undefined) return "-";
  if (pct > 50) return `${pct}%`;
  if (pct > 10) return `${pct}%⚠`;
  return `${pct}%🔴`;
}
