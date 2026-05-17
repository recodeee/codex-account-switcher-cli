import { Command } from "@oclif/core";
import { getSavingsReport } from "../lib/account-savings.js";

export default class Savings extends Command {
  static description = "Show account rotation savings and efficiency stats";

  async run(): Promise<void> {
    const s = getSavingsReport();

    this.log("Account Rotation Savings:\n");
    this.log(`  Total switches:      ${s.totalSwitches}`);
    this.log(`  Auto-switches:       ${s.autoSwitches}`);
    this.log(`  Rate limits avoided: ${s.rateLimitsAvoided}`);
    this.log(`  Cooldown saved:      ~${s.estimatedMinutesSaved} minutes`);
    this.log(`  Last updated:        ${s.lastUpdated}`);

    if (s.totalSwitches > 0) {
      const autoRate = Math.round((s.autoSwitches / s.totalSwitches) * 100);
      this.log(`\n  Auto-switch rate:    ${autoRate}%`);
    }
  }
}
