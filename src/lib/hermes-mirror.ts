import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";

const HERMES_PROJECT = path.join(os.homedir(), "Documents/hermes-agent");
const HERMES_VENV_PY = path.join(HERMES_PROJECT, "venv/bin/python3");
const CODEX_AUTH_JSON = path.join(os.homedir(), ".codex/auth.json");

export interface HermesMirrorResult {
  attempted: boolean;
  switched: boolean;
  reason?: string;
}

function hermesInstalled(): boolean {
  return fs.existsSync(HERMES_VENV_PY) && fs.existsSync(path.join(HERMES_PROJECT, "hermes_cli"));
}

export function mirrorHermesCodexAuth(): HermesMirrorResult {
  if (!hermesInstalled()) {
    return { attempted: false, switched: false, reason: "hermes-agent not installed" };
  }
  if (!fs.existsSync(CODEX_AUTH_JSON)) {
    return { attempted: true, switched: false, reason: "no ~/.codex/auth.json to mirror" };
  }

  const script = [
    "import json, sys",
    "from hermes_cli.auth import _save_codex_tokens",
    `p = json.load(open(${JSON.stringify(CODEX_AUTH_JSON)}))`,
    "t = p.get('tokens') if isinstance(p, dict) else None",
    "if not (isinstance(t, dict) and t.get('access_token') and t.get('refresh_token')):",
    "    sys.exit('codex auth.json missing tokens')",
    "_save_codex_tokens(t, p.get('last_refresh'))",
  ].join("\n");

  const result = spawnSync(HERMES_VENV_PY, ["-c", script], {
    cwd: HERMES_PROJECT,
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 5_000,
  });

  if (result.error) {
    return { attempted: true, switched: false, reason: result.error.message };
  }
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").toString().trim().split("\n").pop() ?? "";
    return { attempted: true, switched: false, reason: stderr || `exit ${result.status}` };
  }
  return { attempted: true, switched: true };
}
