import { exec as execCallback } from "node:child_process";
import fsp from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ParsedAuthSnapshot, RateLimitWindow, UsageSnapshot } from "./types";

const USAGE_ENDPOINT = "https://chatgpt.com/backend-api/wham/usage";
const DEFAULT_PROXY_URL = "http://127.0.0.1:2455";
const DASHBOARD_SESSION_PATH = "/api/dashboard-auth/session";
const PASSWORD_LOGIN_PATH = "/api/dashboard-auth/password/login";
const TOTP_VERIFY_PATH = "/api/dashboard-auth/totp/verify";
const ACCOUNTS_PATH = "/api/accounts";
const REQUEST_TIMEOUT_MS = 5000;
const PROXY_REQUEST_TIMEOUT_MS = 2000;
const DASHBOARD_PASSWORD_ENV = "CODEX_LB_DASHBOARD_PASSWORD";
const DASHBOARD_TOTP_CODE_ENV = "CODEX_LB_DASHBOARD_TOTP_CODE";
const DASHBOARD_TOTP_COMMAND_ENV = "CODEX_LB_DASHBOARD_TOTP_COMMAND";

const execAsync = promisify(execCallback);

interface ProxySessionState {
  authenticated: boolean;
  passwordRequired: boolean;
  totpRequiredOnLogin: boolean;
}

interface ProxyAccountRecord {
  accountId?: string;
  email?: string;
  snapshotNames: string[];
  usage: UsageSnapshot;
}

export interface ProxyUsageIndex {
  byAccountId: Map<string, UsageSnapshot>;
  byEmail: Map<string, UsageSnapshot>;
  bySnapshotName: Map<string, UsageSnapshot>;
}

interface ProxyRequestResult {
  status: number;
  payload: unknown;
}

type HeaderLookup = {
  get?(name: string): string | null;
  getSetCookie?(): string[];
};

type ProxyAccountPayload = {
  accountId?: unknown;
  email?: unknown;
  planType?: unknown;
  usage?: {
    primaryRemainingPercent?: unknown;
    secondaryRemainingPercent?: unknown;
  } | null;
  resetAtPrimary?: unknown;
  resetAtSecondary?: unknown;
  windowMinutesPrimary?: unknown;
  windowMinutesSecondary?: unknown;
  codexAuth?: {
    snapshotName?: unknown;
    listedSnapshotName?: unknown;
  } | null;
};

type ProxyAccountsPayload = {
  accounts?: unknown;
};

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

function parseOptionalTimestampSeconds(input: unknown): number | undefined {
  if (input === undefined || input === null || input === "") {
    return undefined;
  }

  return parseTimestampSeconds(input);
}

function coerceRemainingPercent(remainingRaw: unknown): number | undefined {
  if (typeof remainingRaw !== "number" || !Number.isFinite(remainingRaw)) {
    return undefined;
  }

  return Math.max(0, Math.min(100, 100 - remainingRaw));
}

function normalizeLookupKey(value: string | undefined | null): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

function buildProxyWindow(
  remainingRaw: unknown,
  windowMinutesRaw: unknown,
  resetAtRaw: unknown,
): RateLimitWindow | undefined {
  const usedPercent = coerceRemainingPercent(remainingRaw);
  if (typeof usedPercent !== "number") {
    return undefined;
  }

  return {
    usedPercent,
    windowMinutes: typeof windowMinutesRaw === "number" && Number.isFinite(windowMinutesRaw)
      ? Math.round(windowMinutesRaw)
      : undefined,
    resetsAt: parseOptionalTimestampSeconds(resetAtRaw),
  };
}

function buildSnapshotFromProxyAccount(account: ProxyAccountPayload): UsageSnapshot | null {
  const primary = buildProxyWindow(
    account.usage?.primaryRemainingPercent,
    account.windowMinutesPrimary,
    account.resetAtPrimary,
  );
  const secondary = buildProxyWindow(
    account.usage?.secondaryRemainingPercent,
    account.windowMinutesSecondary,
    account.resetAtSecondary,
  );

  if (!primary && !secondary) {
    return null;
  }

  return {
    primary,
    secondary,
    planType: typeof account.planType === "string" ? account.planType : undefined,
    fetchedAt: new Date().toISOString(),
    source: "proxy",
  };
}

function buildProxyAccountRecord(payload: ProxyAccountPayload): ProxyAccountRecord | null {
  const usage = buildSnapshotFromProxyAccount(payload);
  if (!usage) {
    return null;
  }

  const snapshotNames = [
    payload.codexAuth?.snapshotName,
    payload.codexAuth?.listedSnapshotName,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  return {
    accountId: typeof payload.accountId === "string" ? payload.accountId : undefined,
    email: typeof payload.email === "string" ? payload.email : undefined,
    snapshotNames,
    usage,
  };
}

function storeUsageIndexEntry(map: Map<string, UsageSnapshot>, rawKey: string | undefined, usage: UsageSnapshot): void {
  const normalized = normalizeLookupKey(rawKey);
  if (!normalized || map.has(normalized)) {
    return;
  }

  map.set(normalized, usage);
}

function extractSetCookieHeaders(headers: HeaderLookup | undefined): string[] {
  if (!headers) return [];

  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  if (typeof headers.get === "function") {
    const single = headers.get("set-cookie");
    return single ? [single] : [];
  }

  return [];
}

class DashboardProxyClient {
  private readonly cookies = new Map<string, string>();

  public constructor(private readonly baseUrl: string) {}

  public async fetchJson(
    pathName: string,
    options?: {
      method?: "GET" | "POST";
      payload?: Record<string, unknown>;
    },
  ): Promise<ProxyRequestResult | null> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROXY_REQUEST_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "User-Agent": "codex-auth",
      };
      const cookieHeader = this.buildCookieHeader();
      if (cookieHeader) {
        headers.Cookie = cookieHeader;
      }

      let body: string | undefined;
      if (options?.payload) {
        headers["Content-Type"] = "application/json";
        body = JSON.stringify(options.payload);
      }

      const response = await fetch(new URL(pathName, this.baseUrl), {
        method: options?.method ?? "GET",
        headers,
        body,
        signal: controller.signal,
      });

      this.storeCookies(response.headers as HeaderLookup);

      let payload: unknown = null;
      const raw = await response.text();
      if (raw.trim().length > 0) {
        try {
          payload = JSON.parse(raw) as unknown;
        } catch {
          payload = null;
        }
      }

      return {
        status: response.status,
        payload,
      };
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  private buildCookieHeader(): string | null {
    if (this.cookies.size === 0) {
      return null;
    }

    return Array.from(this.cookies.entries())
      .map(([name, value]) => `${name}=${value}`)
      .join("; ");
  }

  private storeCookies(headers: HeaderLookup | undefined): void {
    for (const cookie of extractSetCookieHeaders(headers)) {
      const firstPair = cookie.split(";")[0];
      const separatorIndex = firstPair.indexOf("=");
      if (separatorIndex <= 0) continue;

      const name = firstPair.slice(0, separatorIndex).trim();
      const value = firstPair.slice(separatorIndex + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }
}

function parseProxySessionState(payload: unknown): ProxySessionState | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const session = payload as Record<string, unknown>;
  return {
    authenticated: Boolean(session.authenticated ?? session.authenticated),
    passwordRequired: Boolean(session.passwordRequired ?? session.password_required),
    totpRequiredOnLogin: Boolean(session.totpRequiredOnLogin ?? session.totp_required_on_login),
  };
}

async function resolveTotpCode(): Promise<string | null> {
  const directCode = process.env[DASHBOARD_TOTP_CODE_ENV]?.trim();
  if (directCode) {
    return directCode;
  }

  const command = process.env[DASHBOARD_TOTP_COMMAND_ENV]?.trim();
  if (!command) {
    return null;
  }

  try {
    const { stdout } = await execAsync(command, { timeout: PROXY_REQUEST_TIMEOUT_MS });
    const code = stdout.trim();
    return code.length > 0 ? code : null;
  } catch {
    return null;
  }
}

async function ensureDashboardSession(client: DashboardProxyClient): Promise<boolean> {
  const sessionResponse = await client.fetchJson(DASHBOARD_SESSION_PATH);
  const initialState = parseProxySessionState(sessionResponse?.payload);
  if (!sessionResponse || sessionResponse.status !== 200 || !initialState) {
    return false;
  }

  if (initialState.authenticated || !initialState.passwordRequired) {
    return true;
  }

  const password = process.env[DASHBOARD_PASSWORD_ENV]?.trim();
  if (!password) {
    return false;
  }

  const loginResponse = await client.fetchJson(PASSWORD_LOGIN_PATH, {
    method: "POST",
    payload: { password },
  });
  if (!loginResponse || loginResponse.status !== 200) {
    return false;
  }

  const loginState = parseProxySessionState((await client.fetchJson(DASHBOARD_SESSION_PATH))?.payload);
  if (!loginState) {
    return false;
  }

  if (loginState.authenticated) {
    return true;
  }

  if (loginState.totpRequiredOnLogin) {
    const code = await resolveTotpCode();
    if (!code) {
      return false;
    }

    const verifyResponse = await client.fetchJson(TOTP_VERIFY_PATH, {
      method: "POST",
      payload: { code },
    });
    if (!verifyResponse || verifyResponse.status !== 200) {
      return false;
    }
  }

  const finalState = parseProxySessionState((await client.fetchJson(DASHBOARD_SESSION_PATH))?.payload);
  return Boolean(finalState?.authenticated);
}

function resolveProxyBaseUrl(): string | null {
  const raw = process.env.CODEX_LB_URL?.trim() || DEFAULT_PROXY_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export async function fetchUsageFromProxy(): Promise<ProxyUsageIndex | null> {
  const baseUrl = resolveProxyBaseUrl();
  if (!baseUrl) {
    return null;
  }

  const client = new DashboardProxyClient(baseUrl);
  if (!(await ensureDashboardSession(client))) {
    return null;
  }

  const accountsResponse = await client.fetchJson(ACCOUNTS_PATH);
  if (!accountsResponse || accountsResponse.status !== 200) {
    return null;
  }

  const payload = accountsResponse.payload as ProxyAccountsPayload | null;
  if (!payload || !Array.isArray(payload.accounts)) {
    return null;
  }

  const index: ProxyUsageIndex = {
    byAccountId: new Map<string, UsageSnapshot>(),
    byEmail: new Map<string, UsageSnapshot>(),
    bySnapshotName: new Map<string, UsageSnapshot>(),
  };

  for (const account of payload.accounts) {
    if (!account || typeof account !== "object") {
      continue;
    }

    const record = buildProxyAccountRecord(account as ProxyAccountPayload);
    if (!record) {
      continue;
    }

    storeUsageIndexEntry(index.byAccountId, record.accountId, record.usage);
    storeUsageIndexEntry(index.byEmail, record.email, record.usage);
    for (const snapshotName of record.snapshotNames) {
      storeUsageIndexEntry(index.bySnapshotName, snapshotName, record.usage);
    }
  }

  return index;
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
