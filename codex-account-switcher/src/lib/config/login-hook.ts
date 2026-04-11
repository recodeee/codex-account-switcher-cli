import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const LOGIN_HOOK_MARK_START = "# >>> codex-auth-login-auto-snapshot >>>";
export const LOGIN_HOOK_MARK_END = "# <<< codex-auth-login-auto-snapshot <<<";

export type HookInstallStatus = "installed" | "already-installed";
export type HookRemoveStatus = "removed" | "not-installed";
export interface LoginHookStatus {
  installed: boolean;
  rcPath: string;
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hookBlockRegex(): RegExp {
  const start = escapeRegex(LOGIN_HOOK_MARK_START);
  const end = escapeRegex(LOGIN_HOOK_MARK_END);
  return new RegExp(`\\n?${start}[\\s\\S]*?${end}\\n?`, "g");
}

export function resolveDefaultShellRcPath(): string {
  const shell = (process.env.SHELL ?? "").toLowerCase();
  if (shell.includes("zsh")) {
    return path.join(os.homedir(), ".zshrc");
  }

  return path.join(os.homedir(), ".bashrc");
}

export function renderLoginHookBlock(): string {
  return [
    LOGIN_HOOK_MARK_START,
    "# Auto-sync codex-auth snapshots after successful official `codex login`.",
    "# Also restore common terminal modes to avoid leaked escape sequences after codex exits.",
    "__codex_auth_restore_tty() {",
    "  [[ -t 1 ]] || return 0",
    "  local __tty_target=/dev/tty",
    "  [[ -w \"$__tty_target\" ]] || __tty_target=/dev/stdout",
    "  printf '\\033[>4m\\033[<u\\033[?2026l\\033[?1004l\\033[?1l\\033[?2004l\\033[?1000l\\033[?1002l\\033[?1003l\\033[?1006l\\033[?1015l\\033[?1049l\\033[0m\\033[?25h\\033[H\\033>' >\"$__tty_target\" 2>/dev/null || true",
    "}",
    "if ! typeset -f codex >/dev/null 2>&1; then",
    "  codex() {",
    "    if command -v codex-auth >/dev/null 2>&1; then",
    "      command codex-auth restore-session >/dev/null 2>&1 || true",
    "    fi",
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
    "        CODEX_AUTH_FORCE_EXTERNAL_SYNC=1 command codex-auth status >/dev/null 2>&1 || true",
    "      fi",
    "    fi",
    "    if [[ -z \"${CODEX_AUTH_SKIP_TTY_RESTORE:-}\" ]]; then",
    "      __codex_auth_restore_tty",
    "    fi",
    "    return $__codex_exit",
    "  }",
    "fi",
    LOGIN_HOOK_MARK_END,
  ].join("\n");
}

export async function installLoginHook(rcPath = resolveDefaultShellRcPath()): Promise<HookInstallStatus> {
  await fsp.mkdir(path.dirname(rcPath), { recursive: true });

  let existing = "";
  try {
    existing = await fsp.readFile(rcPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code !== "ENOENT") throw error;
  }

  if (existing.includes(LOGIN_HOOK_MARK_START) && existing.includes(LOGIN_HOOK_MARK_END)) {
    return "already-installed";
  }

  const next = `${existing.replace(/\s*$/, "")}\n\n${renderLoginHookBlock()}\n`;
  await fsp.writeFile(rcPath, next, "utf8");
  return "installed";
}

export async function removeLoginHook(rcPath = resolveDefaultShellRcPath()): Promise<HookRemoveStatus> {
  let existing = "";
  try {
    existing = await fsp.readFile(rcPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return "not-installed";
    }
    throw error;
  }

  const regex = hookBlockRegex();
  const stripped = existing.replace(regex, "\n");
  if (stripped === existing) {
    return "not-installed";
  }

  await fsp.writeFile(rcPath, stripped.replace(/\n{3,}/g, "\n\n"), "utf8");
  return "removed";
}

export async function getLoginHookStatus(rcPath = resolveDefaultShellRcPath()): Promise<LoginHookStatus> {
  let existing = "";
  try {
    existing = await fsp.readFile(rcPath, "utf8");
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {
        installed: false,
        rcPath,
      };
    }
    throw error;
  }

  const installed = existing.includes(LOGIN_HOOK_MARK_START) && existing.includes(LOGIN_HOOK_MARK_END);
  return {
    installed,
    rcPath,
  };
}
