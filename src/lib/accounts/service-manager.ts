import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type ServiceState = "active" | "inactive" | "unknown";

const LINUX_SERVICE_NAME = "codex-auth-autoswitch.service";
const MAC_LABEL = "com.codex.auth.autoswitch";
const WINDOWS_TASK_NAME = "codex-auth-autoswitch";

interface CommandResult {
  code: number | null;
  stdout: string;
}

function runCommand(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    code: result.status,
    stdout: (result.stdout ?? "").toString(),
  };
}

function linuxUnitPath(): string {
  return path.join(os.homedir(), ".config", "systemd", "user", LINUX_SERVICE_NAME);
}

function linuxUnitContents(): string {
  return [
    "[Unit]",
    "Description=codex-auth auto-switch watcher",
    "",
    "[Service]",
    "Type=simple",
    "Restart=always",
    "RestartSec=1",
    "ExecStart=codex-auth daemon --watch",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

async function enableLinuxService(): Promise<void> {
  const unitPath = linuxUnitPath();
  await fsp.mkdir(path.dirname(unitPath), { recursive: true });
  await fsp.writeFile(unitPath, linuxUnitContents(), "utf8");

  const daemonReload = runCommand("systemctl", ["--user", "daemon-reload"]);
  if (daemonReload.code !== 0) {
    throw new Error("systemctl --user daemon-reload failed");
  }

  const enable = runCommand("systemctl", ["--user", "enable", LINUX_SERVICE_NAME]);
  if (enable.code !== 0) {
    throw new Error("systemctl --user enable failed");
  }

  const start = runCommand("systemctl", ["--user", "start", LINUX_SERVICE_NAME]);
  if (start.code !== 0) {
    throw new Error("systemctl --user start failed");
  }
}

async function disableLinuxService(): Promise<void> {
  runCommand("systemctl", ["--user", "stop", LINUX_SERVICE_NAME]);
  runCommand("systemctl", ["--user", "disable", LINUX_SERVICE_NAME]);

  try {
    await fsp.rm(linuxUnitPath(), { force: true });
  } catch {
    // ignore
  }

  runCommand("systemctl", ["--user", "daemon-reload"]);
}

function linuxServiceState(): ServiceState {
  const result = runCommand("systemctl", ["--user", "is-active", LINUX_SERVICE_NAME]);
  if (result.code === null) return "unknown";
  if (result.code === 0 && result.stdout.trim().startsWith("active")) return "active";
  return "inactive";
}

function macPlistPath(): string {
  return path.join(os.homedir(), "Library", "LaunchAgents", `${MAC_LABEL}.plist`);
}

function macPlistContents(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${MAC_LABEL}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    "    <string>codex-auth</string>",
    "    <string>daemon</string>",
    "    <string>--watch</string>",
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

async function enableMacService(): Promise<void> {
  const plistPath = macPlistPath();
  await fsp.mkdir(path.dirname(plistPath), { recursive: true });
  await fsp.writeFile(plistPath, macPlistContents(), "utf8");

  runCommand("launchctl", ["unload", plistPath]);
  const load = runCommand("launchctl", ["load", plistPath]);
  if (load.code !== 0) {
    throw new Error("launchctl load failed");
  }
}

async function disableMacService(): Promise<void> {
  const plistPath = macPlistPath();
  runCommand("launchctl", ["unload", plistPath]);
  try {
    await fsp.rm(plistPath, { force: true });
  } catch {
    // ignore
  }
}

function macServiceState(): ServiceState {
  const result = runCommand("launchctl", ["list", MAC_LABEL]);
  if (result.code === null) return "unknown";
  return result.code === 0 ? "active" : "inactive";
}

async function enableWindowsService(): Promise<void> {
  const create = runCommand("schtasks", [
    "/Create",
    "/TN",
    WINDOWS_TASK_NAME,
    "/SC",
    "ONLOGON",
    "/TR",
    "cmd /c codex-auth daemon --watch",
    "/F",
  ]);
  if (create.code !== 0) {
    throw new Error("schtasks /Create failed");
  }

  runCommand("schtasks", ["/Run", "/TN", WINDOWS_TASK_NAME]);
}

async function disableWindowsService(): Promise<void> {
  runCommand("schtasks", ["/Delete", "/TN", WINDOWS_TASK_NAME, "/F"]);
}

function windowsServiceState(): ServiceState {
  const query = runCommand("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME]);
  if (query.code === null) return "unknown";
  if (query.code !== 0) return "inactive";

  const verbose = runCommand("schtasks", ["/Query", "/TN", WINDOWS_TASK_NAME, "/V", "/FO", "LIST"]);
  if (verbose.code !== 0) return "inactive";

  const text = verbose.stdout.toLowerCase();
  if (text.includes("running")) return "active";
  return "inactive";
}

export async function enableManagedService(): Promise<void> {
  if (process.platform === "linux") {
    await enableLinuxService();
    return;
  }
  if (process.platform === "darwin") {
    await enableMacService();
    return;
  }
  if (process.platform === "win32") {
    await enableWindowsService();
    return;
  }

  throw new Error(`Managed auto-switch is not supported on platform ${process.platform}.`);
}

export async function disableManagedService(): Promise<void> {
  if (process.platform === "linux") {
    await disableLinuxService();
    return;
  }
  if (process.platform === "darwin") {
    await disableMacService();
    return;
  }
  if (process.platform === "win32") {
    await disableWindowsService();
    return;
  }
}

export function getManagedServiceState(): ServiceState {
  if (process.platform === "linux") return linuxServiceState();
  if (process.platform === "darwin") return macServiceState();
  if (process.platform === "win32") return windowsServiceState();
  return "unknown";
}
