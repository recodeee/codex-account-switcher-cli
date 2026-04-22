import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";
import { removeLoginHook, resolveDefaultShellRcPath } from "../lib/config/login-hook";

export default class RemoveLoginHookCommand extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static description = "Remove the shell hook that keeps terminal snapshot memory in sync";

  static flags = {
    shellRc: Flags.string({
      char: "f",
      description: "Explicit shell rc file path (defaults to ~/.bashrc or ~/.zshrc)",
      required: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(RemoveLoginHookCommand);
      const rcPath = flags.shellRc ?? resolveDefaultShellRcPath();
      const result = await removeLoginHook(rcPath);

      if (result === "not-installed") {
        this.log(`No login auto-snapshot hook found in ${rcPath}.`);
      } else {
        this.log(`Removed login auto-snapshot hook from ${rcPath}.`);
      }
      this.log(`Reload your shell: source ${rcPath}`);
    });
  }
}
