import { Command } from "@oclif/core";
import { AccountService } from "../lib/accounts/account-service.js";
import { forecastAccounts } from "../lib/account-health.js";

export default class Forecast extends Command {
  static description = "Show health forecast for all saved accounts (best-first)";

  async run(): Promise<void> {
    const service = new AccountService();
    const names = await service.listAccountNames();

    if (!names.length) {
      this.log("No saved accounts found.");
      return;
    }

    const forecasts = forecastAccounts(names);
    this.log("Account Health Forecast (best first):\n");
    for (let i = 0; i < forecasts.length; i++) {
      const h = forecasts[i];
      const status = h.usable ? "✓" : "✗";
      this.log(`  [${i + 1}] ${status} ${h.name}: score=${Math.round(h.score)} circuit=${h.circuitState} tokens=${Math.round(h.tokensAvailable)}`);
    }
  }
}
