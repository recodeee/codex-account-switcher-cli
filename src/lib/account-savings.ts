/**
 * Account savings tracker — records switch events and estimates
 * how much quota/cooldown time was saved by smart rotation.
 *
 * Inspired by codex-multi-auth usage ledger and runtime observability.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const SAVINGS_FILE = path.join(os.homedir(), ".codex", "multi-auth", "savings.json");

export interface SavingsData {
  totalSwitches: number;
  autoSwitches: number;
  rateLimitsAvoided: number;
  estimatedMinutesSaved: number;
  lastUpdated: string;
}

function defaultSavings(): SavingsData {
  return { totalSwitches: 0, autoSwitches: 0, rateLimitsAvoided: 0, estimatedMinutesSaved: 0, lastUpdated: new Date().toISOString() };
}

export function getSavingsReport(): SavingsData {
  try {
    if (!fs.existsSync(SAVINGS_FILE)) return defaultSavings();
    return { ...defaultSavings(), ...JSON.parse(fs.readFileSync(SAVINGS_FILE, "utf-8")) };
  } catch {
    return defaultSavings();
  }
}

function writeSavings(data: SavingsData): void {
  try {
    const dir = path.dirname(SAVINGS_FILE);
    fs.mkdirSync(dir, { recursive: true });
    data.lastUpdated = new Date().toISOString();
    fs.writeFileSync(SAVINGS_FILE, JSON.stringify(data, null, 2));
  } catch { /* ignore */ }
}

export function recordSwitch(): void {
  const data = getSavingsReport();
  data.totalSwitches++;
  writeSavings(data);
}

export function recordAutoSwitch(): void {
  const data = getSavingsReport();
  data.totalSwitches++;
  data.autoSwitches++;
  writeSavings(data);
}

export function recordRateLimitAvoided(): void {
  const data = getSavingsReport();
  data.rateLimitsAvoided++;
  // Estimate: each avoided rate limit saves ~5 min of cooldown
  data.estimatedMinutesSaved += 5;
  writeSavings(data);
}
