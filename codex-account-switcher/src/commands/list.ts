import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";

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

      if (!detailed) {
        const accounts = await this.accounts.listAccountNames();
        const current = await this.accounts.getCurrentAccountName();
        if (!accounts.length) {
          this.log("No saved Codex accounts yet. Run `codex-auth save <name>`.");
          return;
        }

        for (const name of accounts) {
          const mark = current === name ? "*" : " ";
          this.log(`${mark} ${name}`);
        }
        return;
      }

      const accounts = await this.accounts.listAccountMappings();
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
          `    plan=${account.planType ?? "-"} usage=${account.usageSource ?? "-"} lastUsageAt=${account.lastUsageAt ?? "-"}`,
        );
      }
    });
  }
}
