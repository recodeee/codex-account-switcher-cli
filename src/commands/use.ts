import { Args, Flags } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command";
import { NoAccountsSavedError, PromptCancelledError } from "../lib/accounts";
import { recordSuccess, recordFailure } from "../lib/account-health";
import { recordSwitch } from "../lib/account-savings";
import { hasKiroSnapshot, switchKiroSnapshot } from "../lib/kiro-mirror";

export default class UseCommand extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static description = "Switch ~/.codex/auth.json to the selected account. Mirrors to Kiro CLI when a matching snapshot exists.";

  static args = {
    account: Args.string({
      name: "account",
      required: false,
      description: "Account to activate",
    }),
  } as const;

  static flags = {
    "no-kiro": Flags.boolean({ description: "Skip Kiro CLI mirror even if a matching snapshot exists" }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args, flags } = await this.parse(UseCommand);
      let account = args.account as string | undefined;

      if (!account) {
        account = await this.promptForAccount();
      }

      let activated: string;
      try {
        activated = await this.accounts.useAccount(account);
        recordSuccess(activated);
        recordSwitch();
        this.log(`Switched Codex auth to "${activated}".`);
      } catch (err) {
        recordFailure(account);
        throw err;
      }

      if (flags["no-kiro"]) return;

      const mirror = switchKiroSnapshot(activated);
      if (mirror.switched) {
        this.log(`Mirrored Kiro CLI to "${mirror.active}".`);
      } else if (mirror.attempted) {
        this.warn(`Kiro mirror skipped: ${mirror.reason}`);
      }
    });
  }

  private async promptForAccount(): Promise<string> {
    const accounts = await this.accounts.listAccountNames();
    if (!accounts.length) {
      throw new NoAccountsSavedError();
    }

    const current = await this.accounts.getCurrentAccountName();
    const initialIndex = current ? Math.max(accounts.indexOf(current), 0) : 0;

    const response = await prompts(
      {
        type: "select",
        name: "account",
        message: "Select account",
        choices: accounts.map((name) => {
          const mark = current === name ? " (active)" : "";
          const kiroStr = hasKiroSnapshot(name) ? " [kiro]" : "";
          return { title: `${name}${mark}${kiroStr}`, value: name };
        }),
        initial: initialIndex,
      },
      {
        onCancel: () => {
          throw new PromptCancelledError();
        },
      },
    );

    const picked = response.account as string | undefined;
    if (!picked) {
      throw new PromptCancelledError();
    }

    return picked;
  }
}
