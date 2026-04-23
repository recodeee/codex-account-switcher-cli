import type { Hook } from "@oclif/core";
import readline from "node:readline/promises";
import {
  fetchLatestNpmVersionCached,
  formatGlobalInstallCommand,
  formatUpdateCompletedMessage,
  formatUpdateSummaryInline,
  getUpdateSummary,
  PACKAGE_NAME,
  runGlobalNpmInstall,
  shouldProceedWithYesDefault,
} from "../../lib/update-check";

const hook: Hook.Init = async function (options) {
  if (options.id) return;
  if (options.argv.length > 0) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const currentVersion = options.config.version;
  if (!currentVersion) return;

  const latestVersion = await fetchLatestNpmVersionCached(PACKAGE_NAME, {
    currentVersion,
    timeoutMs: 900,
  });
  if (!latestVersion) return;
  const summary = getUpdateSummary(currentVersion, latestVersion);
  if (summary.state !== "update-available") return;

  this.log(formatUpdateSummaryInline(summary));
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  let shouldUpdate = false;
  try {
    const answer = await rl.question(`Install codex-auth ${latestVersion} now? [Y/n] `);
    shouldUpdate = shouldProceedWithYesDefault(answer);
  } finally {
    rl.close();
  }

  if (!shouldUpdate) {
    this.log("Skipped update. Run `codex-auth self-update` anytime.");
    return;
  }

  const exitCode = await runGlobalNpmInstall(PACKAGE_NAME, latestVersion);
  if (exitCode === 0) {
    this.log(formatUpdateCompletedMessage(latestVersion));
    return;
  }

  this.log(
    `Update failed (exit code ${exitCode}). Run: ${formatGlobalInstallCommand(PACKAGE_NAME, latestVersion)}`,
  );
};

export default hook;
