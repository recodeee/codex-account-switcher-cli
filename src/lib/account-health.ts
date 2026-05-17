/**
 * Account health scoring, circuit breaker, and token bucket rate limiting.
 *
 * Ported from codex-multi-auth (https://github.com/ndycode/codex-multi-auth)
 * lib/rotation.ts, lib/circuit-breaker.ts, and lib/health.ts.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ---------------------------------------------------------------------------
// Circuit Breaker
// ---------------------------------------------------------------------------

export type CircuitState = "closed" | "open" | "half-open";

export class CircuitBreaker {
  private state: CircuitState = "closed";
  private failures: number[] = [];
  private lastStateChange: number = Date.now();

  constructor(
    private failureThreshold = 3,
    private failureWindowMs = 60_000,
    private resetTimeoutMs = 30_000,
  ) {}

  getState(): CircuitState {
    if (this.state === "open" && Date.now() - this.lastStateChange >= this.resetTimeoutMs) {
      this.state = "half-open";
      this.lastStateChange = Date.now();
    }
    return this.state;
  }

  isAvailable(): boolean {
    return this.getState() !== "open";
  }

  recordSuccess(): void {
    if (this.state === "half-open" || this.state === "open") {
      this.state = "closed";
      this.failures = [];
    }
    this.lastStateChange = Date.now();
  }

  recordFailure(): void {
    const now = Date.now();
    this.failures = this.failures.filter((t) => t >= now - this.failureWindowMs);
    this.failures.push(now);
    if (this.state === "half-open" || this.failures.length >= this.failureThreshold) {
      this.state = "open";
      this.lastStateChange = now;
    }
  }
}

// ---------------------------------------------------------------------------
// Health Score Tracker
// ---------------------------------------------------------------------------

interface HealthEntry {
  score: number;
  lastUpdated: number;
  consecutiveFailures: number;
}

export class HealthScoreTracker {
  entries: Map<string, HealthEntry> = new Map();

  private recover(entry: HealthEntry): number {
    const hours = (Date.now() - entry.lastUpdated) / 3_600_000;
    return Math.min(entry.score + hours * 2, 100);
  }

  getScore(key: string): number {
    const entry = this.entries.get(key);
    return entry ? this.recover(entry) : 100;
  }

  recordSuccess(key: string): void {
    const entry = this.entries.get(key);
    const base = entry ? this.recover(entry) : 100;
    this.entries.set(key, { score: Math.min(base + 1, 100), lastUpdated: Date.now(), consecutiveFailures: 0 });
  }

  recordRateLimit(key: string): void {
    const entry = this.entries.get(key);
    const base = entry ? this.recover(entry) : 100;
    const cf = (entry?.consecutiveFailures ?? 0) + 1;
    this.entries.set(key, { score: Math.max(base - 10, 0), lastUpdated: Date.now(), consecutiveFailures: cf });
  }

  recordFailure(key: string): void {
    const entry = this.entries.get(key);
    const base = entry ? this.recover(entry) : 100;
    const cf = (entry?.consecutiveFailures ?? 0) + 1;
    this.entries.set(key, { score: Math.max(base - 20, 0), lastUpdated: Date.now(), consecutiveFailures: cf });
  }
}

// ---------------------------------------------------------------------------
// Token Bucket
// ---------------------------------------------------------------------------

export class TokenBucketTracker {
  private buckets: Map<string, { tokens: number; lastRefill: number }> = new Map();

  constructor(private maxTokens = 50, private tokensPerMinute = 6) {}

  getTokens(key: string): number {
    const entry = this.buckets.get(key);
    if (!entry) return this.maxTokens;
    const minutes = (Date.now() - entry.lastRefill) / 60_000;
    return Math.min(entry.tokens + minutes * this.tokensPerMinute, this.maxTokens);
  }

  tryConsume(key: string): boolean {
    const current = this.getTokens(key);
    if (current < 1) return false;
    this.buckets.set(key, { tokens: current - 1, lastRefill: Date.now() });
    return true;
  }
}

// ---------------------------------------------------------------------------
// Combined Account Health
// ---------------------------------------------------------------------------

export interface AccountHealth {
  name: string;
  score: number;
  circuitState: CircuitState;
  tokensAvailable: number;
  usable: boolean;
}

// Singleton state
const health = new HealthScoreTracker();
const tokens = new TokenBucketTracker();
const circuits: Map<string, CircuitBreaker> = new Map();

function getCircuit(key: string): CircuitBreaker {
  let cb = circuits.get(key);
  if (!cb) {
    cb = new CircuitBreaker();
    circuits.set(key, cb);
  }
  return cb;
}

const STATE_FILE = path.join(os.homedir(), ".codex", "multi-auth", "health-state.json");

export function loadState(): void {
  try {
    if (!fs.existsSync(STATE_FILE)) return;
    const data = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
    for (const [key, entry] of Object.entries(data.health ?? {})) {
      const e = entry as { score: number; lastUpdated: number; consecutiveFailures: number };
      health.entries.set(key, { score: e.score, lastUpdated: e.lastUpdated, consecutiveFailures: e.consecutiveFailures });
    }
  } catch { /* ignore */ }
}

export function saveState(): void {
  try {
    const dir = path.dirname(STATE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    const data: Record<string, unknown> = { health: {} };
    const h = data.health as Record<string, unknown>;
    for (const [key, entry] of health.entries) {
      h[key] = { score: entry.score, lastUpdated: entry.lastUpdated, consecutiveFailures: entry.consecutiveFailures };
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(data));
  } catch { /* ignore */ }
}

export function recordSuccess(name: string): void {
  health.recordSuccess(name);
  getCircuit(name).recordSuccess();
  saveState();
}

export function recordRateLimit(name: string): void {
  health.recordRateLimit(name);
  getCircuit(name).recordFailure();
  saveState();
}

export function recordFailure(name: string): void {
  health.recordFailure(name);
  getCircuit(name).recordFailure();
  saveState();
}

export function getAccountHealth(name: string): AccountHealth {
  const score = health.getScore(name);
  const cb = getCircuit(name);
  const cs = cb.getState();
  const t = tokens.getTokens(name);
  return { name, score, circuitState: cs, tokensAvailable: t, usable: score >= 50 && cs === "closed" && t >= 1 };
}

export function selectBestAccount(names: string[]): string | undefined {
  if (!names.length) return undefined;
  loadState();
  let best: string | undefined;
  let bestScore = -1;
  for (const n of names) {
    const h = getAccountHealth(n);
    if (h.usable && h.score > bestScore) {
      best = n;
      bestScore = h.score;
    }
  }
  if (!best) {
    best = names.reduce((a, b) => (health.getScore(a) >= health.getScore(b) ? a : b));
  }
  return best;
}

export function forecastAccounts(names: string[]): AccountHealth[] {
  loadState();
  return names.map(getAccountHealth).sort((a, b) => b.score - a.score || (a.usable === b.usable ? 0 : a.usable ? -1 : 1));
}
