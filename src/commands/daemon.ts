import { Flags } from "@oclif/core";
import { BaseCommand } from "../lib/base-command";

export default class DaemonCommand extends BaseCommand {
  static description = "Run the background auto-switch daemon";

  static flags = {
    watch: Flags.boolean({
      description: "Run continuously and evaluate switching every 30s",
      default: false,
    }),
    once: Flags.boolean({
      description: "Run one evaluation pass and exit",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { flags } = await this.parse(DaemonCommand);
      const watch = Boolean(flags.watch);
      const once = Boolean(flags.once);

      if (watch === once) {
        this.error("`daemon` requires exactly one of `--watch` or `--once`.");
      }

      if (once) {
        const result = await this.accounts.runAutoSwitchOnce();
        if (result.switched) {
          this.log(`switched: ${result.fromAccount} -> ${result.toAccount}`);
        } else {
          this.log(`no switch: ${result.reason}`);
        }
        return;
      }

      await this.accounts.runDaemon("watch");
    });
  }
}
