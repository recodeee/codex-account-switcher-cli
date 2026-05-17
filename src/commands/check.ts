import { Command } from "@oclif/core";
import { AccountService } from "../lib/accounts/account-service.js";
import { forecastAccounts, loadState } from "../lib/account-health.js";

export default class Check extends Command {
  static description = "Validate health of all saved accounts";

  async run(): Promise<void> {
    const service = new AccountService();
    const names = await service.listAccountNames();

    if (!names.length) {
      this.log("No saved accounts found.");
      return;
    }

    loadState();
    const forecasts = forecastAccounts(names);
    const healthy = forecasts.filter((h) => h.usable).length;
    const status = healthy === forecasts.length ? "HEALTHY" : healthy > 0 ? "DEGRADED" : "UNHEALTHY";

    this.log(`Pool Health: ${status} (${healthy}/${forecasts.length} usable)\n`);
    for (const h of forecasts) {
      const flags: string[] = [];
      if (h.circuitState !== "closed") flags.push(`circuit-${h.circuitState}`);
      if (h.tokensAvailable < 1) flags.push("rate-limited");
      const flagStr = flags.length ? ` [${flags.join(", ")}]` : "";
      this.log(`  ${h.name}: ${Math.round(h.score)}%${flagStr}`);
    }
  }
}
