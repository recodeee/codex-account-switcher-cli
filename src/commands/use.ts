import { Args } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command";
import { NoAccountsSavedError, PromptCancelledError } from "../lib/accounts";

export default class UseCommand extends BaseCommand {
  static description = "Switch ~/.codex/auth.json to the selected account";

  static args = {
    account: Args.string({
      name: "account",
      required: false,
      description: "Account to activate",
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args } = await this.parse(UseCommand);
      let account = args.account as string | undefined;

      if (!account) {
        account = await this.promptForAccount();
      }

      const activated = await this.accounts.useAccount(account);
      this.log(`Switched Codex auth to "${activated}".`);
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
        choices: accounts.map((name) => ({
          title: current === name ? `${name} (active)` : name,
          value: name,
        })),
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
