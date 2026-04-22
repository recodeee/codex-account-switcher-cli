import { BaseCommand } from "../lib/base-command";

export default class CurrentCommand extends BaseCommand {
  static description = "Show the currently active account name";

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const name = await this.accounts.getCurrentAccountName();
      this.log(name ?? "No Codex account is active yet.");
    });
  }
}
