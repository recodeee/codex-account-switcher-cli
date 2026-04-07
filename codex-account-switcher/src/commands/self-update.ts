import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";
import { fetchLatestNpmVersion, isVersionNewer, PACKAGE_NAME, runGlobalNpmInstall } from "../lib/update-check";

export default class SelfUpdateCommand extends BaseCommand {
  static description = "Check for updates and upgrade codex-auth globally";

  static flags = {
    check: Flags.boolean({
      description: "Only check whether an update is available",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(SelfUpdateCommand);
      const currentVersion = this.config.version;
      const latestVersion = await fetchLatestNpmVersion(PACKAGE_NAME);

      if (!latestVersion) {
        this.warn("Could not check npm for the latest release right now.");
        return;
      }

      if (!isVersionNewer(currentVersion, latestVersion)) {
        this.log(`codex-auth is up to date (${currentVersion}).`);
        return;
      }

      this.log(`Update available: ${currentVersion} -> ${latestVersion}`);
      if (flags.check) {
        return;
      }

      const exitCode = await runGlobalNpmInstall(PACKAGE_NAME);
      if (exitCode === 0) {
        this.log("Global update completed.");
        return;
      }

      this.warn(`Global update failed (exit code ${exitCode}). Run: npm i -g ${PACKAGE_NAME}@latest`);
    });
  }
}
