import { BaseCommand } from "../lib/base-command";

export default class StatusCommand extends BaseCommand {
  static description = "Show auto-switch, service, and usage status";

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const status = await this.accounts.getStatus();
      this.log(`auto-switch: ${status.autoSwitchEnabled ? "ON" : "OFF"}`);
      this.log(`service: ${status.serviceState}`);
      this.log(`thresholds: 5h<${status.threshold5hPercent}%, weekly<${status.thresholdWeeklyPercent}%`);
      this.log(`usage: ${status.usageMode}`);
    });
  }
}
