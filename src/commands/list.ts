import { Flags } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command";
import {
  fetchLatestNpmVersionCached,
  formatGlobalInstallCommand,
  formatUpdateCompletedMessage,
  formatUpdateSummaryInline,
  getUpdateSummary,
  PACKAGE_NAME,
  runGlobalNpmInstall,
} from "../lib/update-check";

export default class ListCommand extends BaseCommand {
  static description = "List accounts managed under ~/.codex";

  static flags = {
    details: Flags.boolean({
      char: "d",
      description: "Show per-account mapping metadata (email/account/user/usage)",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(ListCommand);
      const detailed = Boolean(flags.details);
      await this.maybeOfferGlobalUpdate();

      if (!detailed) {
        const accounts = await this.accounts.listAccountMappings({ refreshUsage: "missing" });
        if (!accounts.length) {
          this.log("No saved Codex accounts yet. Run `codex-auth save <name>`.");
          return;
        }

        for (const account of accounts) {
          const mark = account.active ? "*" : " ";
          this.log(
            `${mark} ${account.name}  5h=${this.formatRemaining(account.remaining5hPercent)}  weekly=${this.formatRemaining(account.remainingWeeklyPercent)}`,
          );
        }
        return;
      }

      const accounts = await this.accounts.listAccountMappings({ refreshUsage: "missing" });
      if (!accounts.length) {
        this.log("No saved Codex accounts yet. Run `codex-auth save <name>`.");
        return;
      }

      for (const account of accounts) {
        const mark = account.active ? "*" : " ";
        this.log(`${mark} ${account.name}`);
        this.log(
          `    email=${account.email ?? "-"} account=${account.accountId ?? "-"} user=${account.userId ?? "-"}`,
        );
        this.log(
          `    plan=${account.planType ?? "-"} usage=${account.usageSource ?? "-"} 5h=${this.formatRemaining(account.remaining5hPercent)} weekly=${this.formatRemaining(account.remainingWeeklyPercent)} lastUsageAt=${account.lastUsageAt ?? "-"}`,
        );
      }
    });
  }

  private formatRemaining(value: number | undefined): string {
    if (typeof value !== "number") {
      return "-";
    }
    return `${value}%`;
  }

  private async maybeOfferGlobalUpdate(): Promise<void> {
    if (!process.stdin.isTTY || !process.stdout.isTTY) return;

    const currentVersion = this.config.version;
    if (!currentVersion || typeof currentVersion !== "string") return;

    const latestVersion = await fetchLatestNpmVersionCached(PACKAGE_NAME, { timeoutMs: 900 });
    if (!latestVersion) return;

    const summary = getUpdateSummary(currentVersion, latestVersion);
    if (summary.state !== "update-available") return;

    this.log(formatUpdateSummaryInline(summary));

    const prompt = await prompts({
      type: "confirm",
      name: "install",
      message: `Press Enter to update globally to ${latestVersion}`,
      initial: true,
    });

    if (!prompt.install) {
      this.log(`Skipped update. Run manually: ${formatGlobalInstallCommand(PACKAGE_NAME, latestVersion)}`);
      return;
    }

    const installExitCode = await runGlobalNpmInstall(PACKAGE_NAME, latestVersion);
    if (installExitCode === 0) {
      this.log(formatUpdateCompletedMessage(latestVersion));
      return;
    }

    this.warn(
      `Global update failed (exit code ${installExitCode}). Try: ${formatGlobalInstallCommand(PACKAGE_NAME, latestVersion)}`,
    );
  }
}
