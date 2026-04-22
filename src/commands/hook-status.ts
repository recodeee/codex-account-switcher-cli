import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";
import { getLoginHookStatus, resolveDefaultShellRcPath } from "../lib/config/login-hook";

export default class HookStatusCommand extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static description = "Show whether the login auto-snapshot shell hook is installed";

  static flags = {
    shellRc: Flags.string({
      char: "f",
      description: "Explicit shell rc file path (defaults to ~/.bashrc or ~/.zshrc)",
      required: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(HookStatusCommand);
      const rcPath = flags.shellRc ?? resolveDefaultShellRcPath();
      const status = await getLoginHookStatus(rcPath);

      this.log(`login-hook: ${status.installed ? "installed" : "not-installed"}`);
      this.log(`rc-file: ${status.rcPath}`);
    });
  }
}
