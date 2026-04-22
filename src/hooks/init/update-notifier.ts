import type { Hook } from "@oclif/core";
import readline from "node:readline/promises";
import {
  fetchLatestNpmVersionCached,
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

  const latestVersion = await fetchLatestNpmVersionCached(PACKAGE_NAME, { timeoutMs: 900 });
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
    const answer = await rl.question("Install the update now? [Y/n] ");
    shouldUpdate = shouldProceedWithYesDefault(answer);
  } finally {
    rl.close();
  }

  if (!shouldUpdate) {
    this.log("Skipped update. Run `codex-auth self-update` anytime.");
    return;
  }

  const exitCode = await runGlobalNpmInstall(PACKAGE_NAME);
  if (exitCode === 0) {
    this.log(`✓ codex-auth updated to ${latestVersion}.`);
    return;
  }

  this.log(`Update failed (exit code ${exitCode}). Run: npm i -g ${PACKAGE_NAME}@latest`);
};

export default hook;
