import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const KIRO_DATA_DIR = path.join(os.homedir(), ".local/share/kiro-cli");
const KIRO_DATA_FILE = path.join(KIRO_DATA_DIR, "data.sqlite3");
const KIRO_SWITCHER_DIR = path.join(
  process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"),
  "kiro-account-switcher",
);
const KIRO_ACTIVE_FILE = path.join(KIRO_SWITCHER_DIR, "active");

export interface KiroMirrorResult {
  attempted: boolean;
  switched: boolean;
  reason?: string;
  active?: string;
}

export function listKiroSnapshots(): string[] {
  if (!fs.existsSync(KIRO_DATA_DIR)) return [];
  return fs
    .readdirSync(KIRO_DATA_DIR)
    .filter((f) => f.endsWith(".sqlite3") && f !== "data.sqlite3")
    .map((f) => f.replace(/\.sqlite3$/, ""))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

export function hasKiroSnapshot(name: string): boolean {
  const snapshot = path.join(KIRO_DATA_DIR, `${name}.sqlite3`);
  return fs.existsSync(snapshot);
}

export function getActiveKiroSnapshot(): string | undefined {
  try {
    const fromFile = fs.readFileSync(KIRO_ACTIVE_FILE, "utf-8").trim();
    if (fromFile) return fromFile;
  } catch {
    // fall through to symlink probe
  }
  try {
    const stat = fs.lstatSync(KIRO_DATA_FILE);
    if (!stat.isSymbolicLink()) return undefined;
    const target = fs.readlinkSync(KIRO_DATA_FILE);
    const base = path.basename(target);
    if (!base.endsWith(".sqlite3") || base === "data.sqlite3") return undefined;
    return base.replace(/\.sqlite3$/, "");
  } catch {
    return undefined;
  }
}

export function switchKiroSnapshot(name: string): KiroMirrorResult {
  if (!fs.existsSync(KIRO_DATA_DIR)) {
    return { attempted: false, switched: false, reason: "kiro-cli not installed" };
  }

  const target = path.join(KIRO_DATA_DIR, `${name}.sqlite3`);
  if (!fs.existsSync(target)) {
    return {
      attempted: true,
      switched: false,
      reason: `no kiro snapshot named "${name}"`,
    };
  }

  // Refuse to clobber an unmanaged real DB. User must convert it first via
  // `agent-auth kiro-login` so we know which named snapshot it belongs to.
  if (fs.existsSync(KIRO_DATA_FILE)) {
    const stat = fs.lstatSync(KIRO_DATA_FILE);
    if (!stat.isSymbolicLink()) {
      return {
        attempted: true,
        switched: false,
        reason:
          "unmanaged kiro data.sqlite3 present (run `agent-auth kiro-login` to convert it before mirroring switches)",
      };
    }
    try {
      fs.unlinkSync(KIRO_DATA_FILE);
    } catch (err) {
      return {
        attempted: true,
        switched: false,
        reason: `failed to remove old kiro symlink: ${(err as Error).message}`,
      };
    }
  }

  try {
    fs.symlinkSync(target, KIRO_DATA_FILE);
  } catch (err) {
    return {
      attempted: true,
      switched: false,
      reason: `failed to symlink kiro data.sqlite3: ${(err as Error).message}`,
    };
  }

  try {
    fs.mkdirSync(KIRO_SWITCHER_DIR, { recursive: true });
    fs.writeFileSync(KIRO_ACTIVE_FILE, name);
  } catch {
    // active-file write is best-effort; the symlink is authoritative
  }

  return { attempted: true, switched: true, active: name };
}
