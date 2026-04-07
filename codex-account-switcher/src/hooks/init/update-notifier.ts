import type { Hook } from "@oclif/core";
import { fetchLatestNpmVersion, isVersionNewer, PACKAGE_NAME } from "../../lib/update-check";

const hook: Hook.Init = async function (options) {
  if (options.id) return;
  if (options.argv.length > 0) return;
  if (!process.stdin.isTTY || !process.stdout.isTTY) return;

  const currentVersion = options.config.version;
  if (!currentVersion) return;

  const latestVersion = await fetchLatestNpmVersion(PACKAGE_NAME);
  if (!latestVersion || !isVersionNewer(currentVersion, latestVersion)) return;

  this.log(`Update available for codex-auth: ${currentVersion} -> ${latestVersion}`);
  this.log("Run `codex-auth self-update` to install the latest version.");
};

export default hook;
