import { Command } from "@oclif/core";
import { AccountService } from "../lib/accounts/account-service.js";
import { selectBestAccount, recordSuccess, recordFailure } from "../lib/account-health.js";
import { recordAutoSwitch } from "../lib/account-savings.js";

export default class AutoSwitch extends Command {
  static description = "Automatically switch to the healthiest account";

  async run(): Promise<void> {
    const service = new AccountService();
    const names = await service.listAccountNames();

    if (!names.length) {
      this.error("No saved accounts found.");
    }

    const best = selectBestAccount(names);
    if (!best) {
      this.error("Could not determine best account.");
    }

    try {
      await service.useAccount(best);
      recordSuccess(best);
      recordAutoSwitch();
      this.log(`Auto-switched to: ${best}`);
    } catch (err) {
      recordFailure(best);
      this.error(`Failed to switch to ${best}: ${err}`);
    }
  }
}
