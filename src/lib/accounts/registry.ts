import fsp from "node:fs/promises";
import path from "node:path";
import { resolveRegistryPath } from "../config/paths";
import {
  AccountRegistryEntry,
  DEFAULT_THRESHOLD_5H_PERCENT,
  DEFAULT_THRESHOLD_WEEKLY_PERCENT,
  RegistryData,
  UsageSnapshot,
} from "./types";

function nowIso(): string {
  return new Date().toISOString();
}

function clampPercent(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 100) return fallback;
  return rounded;
}

function sanitizeUsageSnapshot(input: unknown): UsageSnapshot | undefined {
  if (!input || typeof input !== "object") return undefined;
  const sourceRaw = (input as Record<string, unknown>).source;
  const source = sourceRaw === "api" || sourceRaw === "local" || sourceRaw === "cached" ? sourceRaw : "cached";

  const normalizeWindow = (raw: unknown) => {
    if (!raw || typeof raw !== "object") return undefined;
    const windowRaw = raw as Record<string, unknown>;
    const used = windowRaw.usedPercent;
    if (typeof used !== "number" || !Number.isFinite(used)) return undefined;

    const windowMinutes = typeof windowRaw.windowMinutes === "number" && Number.isFinite(windowRaw.windowMinutes)
      ? Math.round(windowRaw.windowMinutes)
      : undefined;
    const resetsAt = typeof windowRaw.resetsAt === "number" && Number.isFinite(windowRaw.resetsAt)
      ? Math.round(windowRaw.resetsAt)
      : undefined;

    return {
      usedPercent: Math.max(0, Math.min(100, used)),
      windowMinutes,
      resetsAt,
    };
  };

  const primary = normalizeWindow((input as Record<string, unknown>).primary);
  const secondary = normalizeWindow((input as Record<string, unknown>).secondary);
  if (!primary && !secondary) return undefined;

  return {
    primary,
    secondary,
    fetchedAt:
      typeof (input as Record<string, unknown>).fetchedAt === "string"
        ? ((input as Record<string, unknown>).fetchedAt as string)
        : nowIso(),
    planType:
      typeof (input as Record<string, unknown>).planType === "string"
        ? ((input as Record<string, unknown>).planType as string)
        : undefined,
    source,
  };
}

function sanitizeEntry(name: string, entry: unknown): AccountRegistryEntry {
  const raw = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
  const sanitizedUsage = sanitizeUsageSnapshot(raw.lastUsage);

  return {
    name,
    createdAt: typeof raw.createdAt === "string" ? (raw.createdAt as string) : nowIso(),
    email: typeof raw.email === "string" ? (raw.email as string) : undefined,
    accountId: typeof raw.accountId === "string" ? (raw.accountId as string) : undefined,
    userId: typeof raw.userId === "string" ? (raw.userId as string) : undefined,
    planType: typeof raw.planType === "string" ? (raw.planType as string) : undefined,
    lastUsageAt: typeof raw.lastUsageAt === "string" ? (raw.lastUsageAt as string) : undefined,
    lastUsage: sanitizedUsage,
  };
}

export function createDefaultRegistry(): RegistryData {
  return {
    version: 1,
    autoSwitch: {
      enabled: false,
      threshold5hPercent: DEFAULT_THRESHOLD_5H_PERCENT,
      thresholdWeeklyPercent: DEFAULT_THRESHOLD_WEEKLY_PERCENT,
    },
    api: {
      usage: true,
    },
    accounts: {},
  };
}

export function sanitizeRegistry(input: unknown): RegistryData {
  const defaults = createDefaultRegistry();
  if (!input || typeof input !== "object") return defaults;

  const root = input as Record<string, unknown>;
  const autoSwitch = root.autoSwitch && typeof root.autoSwitch === "object"
    ? (root.autoSwitch as Record<string, unknown>)
    : {};
  const api = root.api && typeof root.api === "object" ? (root.api as Record<string, unknown>) : {};
  const accountsRaw = root.accounts && typeof root.accounts === "object"
    ? (root.accounts as Record<string, unknown>)
    : {};

  const accounts: Record<string, AccountRegistryEntry> = {};
  for (const [name, value] of Object.entries(accountsRaw)) {
    accounts[name] = sanitizeEntry(name, value);
  }

  return {
    version: 1,
    autoSwitch: {
      enabled: typeof autoSwitch.enabled === "boolean" ? autoSwitch.enabled : defaults.autoSwitch.enabled,
      threshold5hPercent: clampPercent(autoSwitch.threshold5hPercent, defaults.autoSwitch.threshold5hPercent),
      thresholdWeeklyPercent: clampPercent(
        autoSwitch.thresholdWeeklyPercent,
        defaults.autoSwitch.thresholdWeeklyPercent,
      ),
    },
    api: {
      usage: typeof api.usage === "boolean" ? api.usage : defaults.api.usage,
    },
    activeAccountName:
      typeof root.activeAccountName === "string" && root.activeAccountName.length > 0
        ? (root.activeAccountName as string)
        : undefined,
    accounts,
  };
}

export async function loadRegistry(): Promise<RegistryData> {
  const registryPath = resolveRegistryPath();
  try {
    const raw = await fsp.readFile(registryPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return sanitizeRegistry(parsed);
  } catch {
    return createDefaultRegistry();
  }
}

export async function saveRegistry(registry: RegistryData): Promise<void> {
  const registryPath = resolveRegistryPath();
  await fsp.mkdir(path.dirname(registryPath), { recursive: true });
  await fsp.writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export function reconcileRegistryWithAccounts(registry: RegistryData, accountNames: string[]): RegistryData {
  const next = sanitizeRegistry(registry);
  const accountSet = new Set(accountNames);
  const now = nowIso();

  for (const name of accountNames) {
    if (!next.accounts[name]) {
      next.accounts[name] = {
        name,
        createdAt: now,
      };
    } else {
      next.accounts[name].name = name;
    }
  }

  for (const name of Object.keys(next.accounts)) {
    if (!accountSet.has(name)) {
      delete next.accounts[name];
    }
  }

  if (next.activeAccountName && !accountSet.has(next.activeAccountName)) {
    delete next.activeAccountName;
  }

  return next;
}
