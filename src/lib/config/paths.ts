import os from "node:os";
import path from "node:path";

function resolvePath(raw: string): string {
  const expanded = raw.startsWith("~") ? path.join(os.homedir(), raw.slice(1)) : raw;
  return path.resolve(expanded);
}

export function resolveCodexDir(): string {
  const envPath = process.env.CODEX_AUTH_CODEX_DIR;
  if (envPath && envPath.trim().length > 0) {
    return resolvePath(envPath.trim());
  }

  return path.join(os.homedir(), ".codex");
}

export function resolveAccountsDir(): string {
  const envPath = process.env.CODEX_AUTH_ACCOUNTS_DIR;
  if (envPath && envPath.trim().length > 0) {
    return resolvePath(envPath.trim());
  }

  return path.join(resolveCodexDir(), "accounts");
}

export function resolveAuthPath(): string {
  const envPath = process.env.CODEX_AUTH_JSON_PATH;
  if (envPath && envPath.trim().length > 0) {
    return resolvePath(envPath.trim());
  }

  return path.join(resolveCodexDir(), "auth.json");
}

export function resolveCurrentNamePath(): string {
  const envPath = process.env.CODEX_AUTH_CURRENT_PATH;
  if (envPath && envPath.trim().length > 0) {
    return resolvePath(envPath.trim());
  }

  return path.join(resolveCodexDir(), "current");
}

export function resolveRegistryPath(): string {
  return path.join(resolveAccountsDir(), "registry.json");
}

export function resolveSessionMapPath(): string {
  const envPath = process.env.CODEX_AUTH_SESSION_MAP_PATH;
  if (envPath && envPath.trim().length > 0) {
    return resolvePath(envPath.trim());
  }

  return path.join(resolveAccountsDir(), "sessions.json");
}

export const codexDir: string = resolveCodexDir();
export const accountsDir: string = resolveAccountsDir();
export const authPath: string = resolveAuthPath();
export const currentNamePath: string = resolveCurrentNamePath();
export const registryPath: string = resolveRegistryPath();
export const sessionMapPath: string = resolveSessionMapPath();
