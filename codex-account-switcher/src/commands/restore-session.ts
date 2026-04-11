import { BaseCommand } from "../lib/base-command";

export default class RestoreSessionCommand extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static hidden = true;
  static description = "Restore auth.json from the session-pinned snapshot (internal helper)";

  async run(): Promise<void> {
    await this.runSafe(async () => {
      await this.accounts.restoreSessionSnapshotIfNeeded();
    });
  }
}
