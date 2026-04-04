import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";

export default class SaveCommand extends BaseCommand {
  static description =
    "Save the current ~/.codex/auth.json as a named account (or infer one from auth email)";

  static args = {
    name: Args.string({
      name: "name",
      required: false,
      description: "Optional account snapshot name. If omitted, inferred from auth email",
    }),
  } as const;

  static flags = {
    force: Flags.boolean({
      char: "f",
      description:
        "Force overwrite when the existing snapshot name belongs to a different email account",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args, flags } = await this.parse(SaveCommand);
      const providedName = args.name as string | undefined;
      const resolvedName = providedName
        ? { name: providedName, source: "explicit" as const }
        : await this.accounts.resolveDefaultAccountNameFromCurrentAuth();
      const savedName = await this.accounts.saveAccount(resolvedName.name, {
        force: Boolean(flags.force),
      });
      const suffix =
        resolvedName.source === "explicit"
          ? ""
          : resolvedName.source === "active"
            ? " (reused active account name)"
            : " (inferred from auth email)";
      this.log(`Saved current Codex auth tokens as "${savedName}"${suffix}.`);
    });
  }
}
