import { Args, Flags } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command";
import {
  AccountChoice,
  AccountNotFoundError,
  InvalidRemoveSelectionError,
  PromptCancelledError,
} from "../lib/accounts";

export default class RemoveCommand extends BaseCommand {
  static description = "Remove accounts with interactive multi-select";

  static args = {
    query: Args.string({
      name: "query",
      required: false,
      description: "Account selector by name or email fragment",
    }),
  } as const;

  static flags = {
    all: Flags.boolean({
      char: "a",
      description: "Remove all saved accounts",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args, flags } = await this.parse(RemoveCommand);
      const query = args.query as string | undefined;
      const removeAll = Boolean(flags.all);

      if (query && removeAll) {
        this.error("`remove` cannot combine a query with `--all`.");
      }

      let selectedNames: string[];
      if (removeAll) {
        selectedNames = (await this.accounts.listAccountNames()).slice();
      } else if (query) {
        selectedNames = await this.selectQueryMatches(query);
      } else {
        selectedNames = await this.promptForAccounts(await this.accounts.listAccountChoices());
      }

      if (selectedNames.length === 0) {
        throw new InvalidRemoveSelectionError();
      }

      const result = await this.accounts.removeAccounts(selectedNames);
      this.log(`Removed ${result.removed.length} account(s): ${result.removed.join(", ")}`);
      if (result.activated) {
        this.log(`Activated fallback account: ${result.activated}`);
      }
    });
  }

  private async selectQueryMatches(query: string): Promise<string[]> {
    const matches = await this.accounts.findMatchingAccounts(query);
    if (matches.length === 0) {
      throw new AccountNotFoundError(query);
    }

    if (matches.length === 1) {
      return [matches[0].name];
    }

    if (!process.stdin.isTTY) {
      this.error(
        `Query "${query}" matched multiple accounts in non-interactive mode. Refine the query or run with a TTY.`,
      );
    }

    return this.promptForAccounts(matches);
  }

  private async promptForAccounts(choices: AccountChoice[]): Promise<string[]> {
    if (choices.length === 0) {
      throw new AccountNotFoundError("*");
    }

    const response = await prompts(
      {
        type: "multiselect",
        name: "accounts",
        message: "Select accounts to remove",
        choices: choices.map((choice) => ({
          title: this.buildChoiceLabel(choice),
          value: choice.name,
          selected: false,
        })),
        instructions: false,
        hint: "Space to toggle, Enter to confirm",
      },
      {
        onCancel: () => {
          throw new PromptCancelledError();
        },
      },
    );

    const accounts = response.accounts as string[] | undefined;
    if (!accounts) {
      throw new PromptCancelledError();
    }

    return accounts;
  }

  private buildChoiceLabel(choice: AccountChoice): string {
    const parts = [choice.name];
    if (choice.email) {
      parts.push(`<${choice.email}>`);
    }
    if (choice.active) {
      parts.push("(active)");
    }
    return parts.join(" ");
  }
}
