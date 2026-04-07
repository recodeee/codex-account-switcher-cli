import { Flags } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command";
import { fetchLatestNpmVersion, isVersionNewer, PACKAGE_NAME, runGlobalNpmInstall } from "../lib/update-check";

export default class SelfUpdateCommand extends BaseCommand {
  static description = "Check for updates and upgrade codex-auth globally";

  static flags = {
    check: Flags.boolean({
      description: "Only check whether an update is available",
      default: false,
    }),
    reinstall: Flags.boolean({
      char: "r",
      description: "Reinstall the latest version even when already up to date",
      default: false,
    }),
    yes: Flags.boolean({
      char: "y",
      description: "Skip confirmation prompts",
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

      const hasUpdate = isVersionNewer(currentVersion, latestVersion);
      if (flags.check) {
        this.log(`Current: ${currentVersion}`);
        this.log(`Latest:  ${latestVersion}`);
        this.log(hasUpdate ? "Status:  update available" : "Status:  up to date");
        return;
      }

      if (!hasUpdate && !flags.reinstall) {
        this.log(`codex-auth is up to date (current ${currentVersion}, latest ${latestVersion}).`);
        this.log("Use `codex-auth self-update --reinstall` if you want to reinstall anyway.");
        return;
      }

      if (hasUpdate) {
        this.log(`Update available: ${currentVersion} -> ${latestVersion}`);
      } else {
        this.log(`Reinstall requested for latest version (${latestVersion}).`);
      }

      if (!flags.yes) {
        const response = await prompts({
          type: "confirm",
          name: "proceed",
          message: "Proceed with global npm update now?",
          initial: true,
        });

        if (!response.proceed) {
          this.log("Update cancelled.");
          return;
        }
      }

      const exitCode = await runGlobalNpmInstall(PACKAGE_NAME);
      if (exitCode === 0) {
        this.log(`Global update completed (installed ${latestVersion}).`);
        return;
      }

      this.warn(`Global update failed (exit code ${exitCode}). Run: npm i -g ${PACKAGE_NAME}@latest`);
    });
  }
}
