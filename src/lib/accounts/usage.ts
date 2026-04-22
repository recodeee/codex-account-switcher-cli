import fsp from "node:fs/promises";
import path from "node:path";
import { ParsedAuthSnapshot, RateLimitWindow, UsageSnapshot } from "./types";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 5000;

function coerceWindow(raw: unknown): RateLimitWindow | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const value = raw as Record<string, unknown>;
  const usedRaw = value.used_percent;
  if (typeof usedRaw !== "number" || !Number.isFinite(usedRaw)) return undefined;

  const windowMinutes = typeof value.window_minutes === "number"
    ? Math.round(value.window_minutes)
    : typeof value.limit_window_seconds === "number"
      ? Math.ceil(value.limit_window_seconds / 60)
      : undefined;

  const resetsAt = typeof value.resets_at === "number"
    ? Math.round(value.resets_at)
    : typeof value.reset_at === "number"
      ? Math.round(value.reset_at)
      : undefined;

  return {
    usedPercent: Math.max(0, Math.min(100, usedRaw)),
    windowMinutes,
    resetsAt,
  };
}

function buildSnapshotFromRateLimits(rateLimits: unknown, source: UsageSnapshot["source"]): UsageSnapshot | null {
  if (!rateLimits || typeof rateLimits !== "object") return null;
  const input = rateLimits as Record<string, unknown>;

  const primary = coerceWindow(input.primary_window ?? input.primary);
  const secondary = coerceWindow(input.secondary_window ?? input.secondary);
  if (!primary && !secondary) return null;

  const planType = typeof input.plan_type === "string" ? input.plan_type : undefined;
  return {
    primary,
    secondary,
    planType,
    fetchedAt: new Date().toISOString(),
    source,
  };
}

function findNestedRateLimits(input: unknown): unknown {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  if (root.rate_limits) return root.rate_limits;
  if (root.payload && typeof root.payload === "object") {
    const payload = root.payload as Record<string, unknown>;
    if (payload.rate_limits) return payload.rate_limits;
    if (payload.event && typeof payload.event === "object") {
      const event = payload.event as Record<string, unknown>;
      if (event.rate_limits) return event.rate_limits;
    }
  }
  return null;
}

function parseTimestampSeconds(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input > 1_000_000_000_000) {
      return Math.floor(input / 1000);
    }
    return Math.floor(input);
  }

  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (!Number.isNaN(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return Math.floor(Date.now() / 1000);
}

export function resolveRateWindow(snapshot: UsageSnapshot | undefined, minutes: number, fallbackPrimary: boolean): RateLimitWindow | undefined {
  if (!snapshot) return undefined;

  if (snapshot.primary && snapshot.primary.windowMinutes === minutes) {
    return snapshot.primary;
  }

  if (snapshot.secondary && snapshot.secondary.windowMinutes === minutes) {
    return snapshot.secondary;
  }

  return fallbackPrimary ? snapshot.primary : snapshot.secondary;
}

export function remainingPercent(window: RateLimitWindow | undefined, nowSeconds: number): number | undefined {
  if (!window) return undefined;
  if (typeof window.resetsAt === "number" && window.resetsAt <= nowSeconds) return 100;

  const remaining = 100 - window.usedPercent;
  if (remaining <= 0) return 0;
  if (remaining >= 100) return 100;
  return Math.trunc(remaining);
}

export function usageScore(snapshot: UsageSnapshot | undefined, nowSeconds: number): number | undefined {
  const fiveHour = remainingPercent(resolveRateWindow(snapshot, 300, true), nowSeconds);
  const weekly = remainingPercent(resolveRateWindow(snapshot, 10080, false), nowSeconds);

  if (typeof fiveHour === "number" && typeof weekly === "number") return Math.min(fiveHour, weekly);
  if (typeof fiveHour === "number") return fiveHour;
  if (typeof weekly === "number") return weekly;
  return undefined;
}

export function shouldSwitchCurrent(
  snapshot: UsageSnapshot | undefined,
  thresholds: { threshold5hPercent: number; thresholdWeeklyPercent: number },
  nowSeconds: number,
): boolean {
  const remaining5h = remainingPercent(resolveRateWindow(snapshot, 300, true), nowSeconds);
  const remainingWeekly = remainingPercent(resolveRateWindow(snapshot, 10080, false), nowSeconds);

  return (
    (typeof remaining5h === "number" && remaining5h < thresholds.threshold5hPercent) ||
    (typeof remainingWeekly === "number" && remainingWeekly < thresholds.thresholdWeeklyPercent)
  );
}

export async function fetchUsageFromApi(snapshotInfo: ParsedAuthSnapshot): Promise<UsageSnapshot | null> {
  if (snapshotInfo.authMode !== "chatgpt" || !snapshotInfo.accessToken || !snapshotInfo.accountId) {
    return null;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(USAGE_ENDPOINT, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${snapshotInfo.accessToken}`,
        "ChatGPT-Account-Id": snapshotInfo.accountId,
        "User-Agent": "codex-auth",
      },
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as Record<string, unknown>;
    const snapshot = buildSnapshotFromRateLimits(data.rate_limit, "api");
    if (!snapshot) return null;

    if (!snapshot.planType && typeof data.plan_type === "string") {
      snapshot.planType = data.plan_type;
    }

    return snapshot;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function collectRolloutFiles(sessionsDir: string): Promise<string[]> {
  const pending: string[] = [sessionsDir];
  const rolloutFiles: Array<{ filePath: string; mtimeMs: number }> = [];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) continue;

    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(fullPath);
        continue;
      }

      if (!entry.isFile()) continue;
      if (!entry.name.startsWith("rollout-") || !entry.name.endsWith(".jsonl")) continue;

      try {
        const stat = await fsp.stat(fullPath);
        rolloutFiles.push({ filePath: fullPath, mtimeMs: stat.mtimeMs });
      } catch {
        // ignore unreadable files
      }
    }
  }

  rolloutFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return rolloutFiles.slice(0, 5).map((entry) => entry.filePath);
}

async function parseRolloutForUsage(filePath: string): Promise<{ snapshot: UsageSnapshot; timestampSeconds: number } | null> {
  let raw: string;
  try {
    raw = await fsp.readFile(filePath, "utf8");
  } catch {
    return null;
  }

  let latest: { snapshot: UsageSnapshot; timestampSeconds: number } | null = null;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let record: unknown;
    try {
      record = JSON.parse(trimmed) as unknown;
    } catch {
      continue;
    }

    const rateLimits = findNestedRateLimits(record);
    const snapshot = buildSnapshotFromRateLimits(rateLimits, "local");
    if (!snapshot) continue;

    const row = record as Record<string, unknown>;
    const timestampSeconds = parseTimestampSeconds(
      row.event_timestamp_ms ?? row.timestamp_ms ?? row.timestamp,
    );

    if (!latest || timestampSeconds >= latest.timestampSeconds) {
      latest = {
        snapshot,
        timestampSeconds,
      };
    }
  }

  return latest;
}

export async function fetchUsageFromLocal(codexDir: string): Promise<UsageSnapshot | null> {
  const sessionsDir = path.join(codexDir, "sessions");
  const files = await collectRolloutFiles(sessionsDir);
  for (const filePath of files) {
    const latest = await parseRolloutForUsage(filePath);
    if (latest) {
      return latest.snapshot;
    }
  }

  return null;
}
