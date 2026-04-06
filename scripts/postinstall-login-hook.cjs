#!/usr/bin/env node

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline/promises");

const MARK_START = "# >>> codex-auth-login-auto-snapshot >>>";
const MARK_END = "# <<< codex-auth-login-auto-snapshot <<<";

function isTruthy(value) {
  return typeof value === "string" && /^(1|true|yes|on)$/i.test(value.trim());
}

function targetShellRc() {
  const shell = (process.env.SHELL || "").toLowerCase();
  if (shell.includes("zsh")) return path.join(os.homedir(), ".zshrc");
  return path.join(os.homedir(), ".bashrc");
}

function renderHookBlock() {
  return [
    MARK_START,
    "# Auto-sync codex-auth snapshots after successful official `codex login`.",
    "if ! typeset -f codex >/dev/null 2>&1; then",
    "  codex() {",
    "    command codex \"$@\"",
    "    local __codex_exit=$?",
    "    if [[ $__codex_exit -eq 0 ]]; then",
    "      local __first_non_flag=\"\"",
    "      local __arg",
    "      for __arg in \"$@\"; do",
    "        case \"$__arg\" in",
    "          --) break ;;",
    "          -*) ;;",
    "          *) __first_non_flag=\"$__arg\"; break ;;",
    "        esac",
    "      done",
    "      if [[ \"$__first_non_flag\" == \"login\" ]] && command -v codex-auth >/dev/null 2>&1; then",
    "        command codex-auth status >/dev/null 2>&1 || true",
    "      fi",
    "    fi",
    "    return $__codex_exit",
    "  }",
    "fi",
    MARK_END,
  ].join("\n");
}

async function maybeInstallHook() {
  if (process.env.npm_config_global !== "true") return;
  if (isTruthy(process.env.CODEX_AUTH_SKIP_POSTINSTALL)) return;
  if (isTruthy(process.env.CI)) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const rcPath = targetShellRc();
  await fs.mkdir(path.dirname(rcPath), { recursive: true });

  let rc = "";
  try {
    rc = await fs.readFile(rcPath, "utf8");
  } catch (error) {
    if (error && error.code !== "ENOENT") throw error;
  }

  if (rc.includes(MARK_START) && rc.includes(MARK_END)) return;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    const answer = await rl.question(
      `Install optional codex login auto-snapshot hook in ${rcPath}? [y/N] `,
    );
    if (!/^(y|yes)$/i.test((answer || "").trim())) return;
  } finally {
    rl.close();
  }

  const next = `${rc.replace(/\s*$/, "")}\n\n${renderHookBlock()}\n`;
  await fs.writeFile(rcPath, next, "utf8");
  process.stdout.write(`\nInstalled shell hook in ${rcPath}. Restart terminal or run: source ${rcPath}\n`);
}

maybeInstallHook().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[codex-auth postinstall] Failed to install login hook: ${message}\n`);
});
