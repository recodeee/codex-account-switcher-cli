import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";
import { installLoginHook, resolveDefaultShellRcPath } from "../lib/config/login-hook";

export default class SetupLoginHookCommand extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static description = "Install a shell hook that auto-syncs snapshots after successful `codex login`";

  static flags = {
    shellRc: Flags.string({
      char: "f",
      description: "Explicit shell rc file path (defaults to ~/.bashrc or ~/.zshrc)",
      required: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(SetupLoginHookCommand);
      const rcPath = flags.shellRc ?? resolveDefaultShellRcPath();
      const result = await installLoginHook(rcPath);

      if (result === "already-installed") {
        this.log(`Login auto-snapshot hook is already installed in ${rcPath}.`);
      } else {
        this.log(`Installed login auto-snapshot hook in ${rcPath}.`);
      }
      this.log(`Reload your shell: source ${rcPath}`);
    });
  }
}
