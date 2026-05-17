import { Args, Flags } from "@oclif/core";
import prompts from "prompts";
import { BaseCommand } from "../lib/base-command.js";
import { NoAccountsSavedError, PromptCancelledError } from "../lib/accounts/index.js";
import { recordSuccess, recordFailure } from "../lib/account-health.js";
import { recordSwitch } from "../lib/account-savings.js";
import { fetchUsage, formatUsageCell } from "../lib/usage-refresh.js";
import { hasKiroSnapshot, switchKiroSnapshot } from "../lib/kiro-mirror.js";
import { mirrorHermesCodexAuth } from "../lib/hermes-mirror.js";

export default class Switch extends BaseCommand {
  protected readonly syncExternalAuthBeforeRun = false;

  static description = "Switch the active account (interactive or by query: row number, email/alias fragment). Mirrors to Kiro CLI when a matching snapshot exists.";

  static args = {
    query: Args.string({ description: "Row number, email fragment, or alias to switch to directly", required: false }),
  } as const;

  static flags = {
    live: Flags.boolean({ description: "Show live usage before picking" }),
    "skip-api": Flags.boolean({ description: "Skip remote API usage refresh" }),
    "no-kiro": Flags.boolean({ description: "Skip Kiro CLI mirror even if a matching snapshot exists" }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args, flags } = await this.parse(Switch);
      const accounts = await this.accounts.listAccountNames();

      if (!accounts.length) throw new NoAccountsSavedError();

      const mirrorKiro = !flags["no-kiro"];

      // Query mode: direct switch by number or fragment
      if (args.query) {
        const target = this.resolveQuery(args.query, accounts);
        if (!target) {
          this.error(`No account matching "${args.query}". Available: ${accounts.join(", ")}`);
        }
        await this.doSwitch(target, mirrorKiro);
        return;
      }

      // Interactive mode
      const current = await this.accounts.getCurrentAccountName();

      // Optionally show usage
      let usageMap: Map<string, string> = new Map();
      if (flags.live && !flags["skip-api"]) {
        this.log("Refreshing usage...");
        for (const name of accounts) {
          const usage = await fetchUsage(name);
          const label = usage?.primary ? formatUsageCell(usage.primary.remainingPercent) : "-";
          usageMap.set(name, label);
        }
      }

      const choices = accounts.map((name, i) => {
        const mark = name === current ? " (active)" : "";
        const usage = usageMap.get(name);
        const usageStr = usage ? ` [5h: ${usage}]` : "";
        const kiroStr = hasKiroSnapshot(name) ? " [kiro]" : "";
        return { title: `${i + 1}) ${name}${mark}${usageStr}${kiroStr}`, value: name };
      });

      const response = await prompts(
        { type: "select", name: "account", message: "Switch to:", choices, initial: current ? Math.max(accounts.indexOf(current), 0) : 0 },
        { onCancel: () => { throw new PromptCancelledError(); } },
      );

      if (!response.account) throw new PromptCancelledError();
      await this.doSwitch(response.account, mirrorKiro);
    });
  }

  private resolveQuery(query: string, accounts: string[]): string | undefined {
    // Try row number
    const num = parseInt(query, 10);
    if (!isNaN(num) && num >= 1 && num <= accounts.length) {
      return accounts[num - 1];
    }

    // Try exact match
    const exact = accounts.find((a) => a === query);
    if (exact) return exact;

    // Try fragment match (case-insensitive)
    const q = query.toLowerCase();
    const matches = accounts.filter((a) => a.toLowerCase().includes(q));
    if (matches.length === 1) return matches[0];

    return undefined;
  }

  private async doSwitch(name: string, mirrorKiro: boolean): Promise<void> {
    let activated: string;
    try {
      activated = await this.accounts.useAccount(name);
      recordSuccess(activated);
      recordSwitch();
      this.log(`Switched to: ${activated}`);
    } catch (err) {
      recordFailure(name);
      throw err;
    }

    const hermesMirror = mirrorHermesCodexAuth();
    if (hermesMirror.switched) {
      this.log(`Mirrored hermes-agent codex auth.`);
    } else if (hermesMirror.attempted) {
      this.warn(`Hermes mirror skipped: ${hermesMirror.reason}`);
    }

    if (!mirrorKiro) return;

    const mirror = switchKiroSnapshot(activated);
    if (mirror.switched) {
      this.log(`Mirrored Kiro CLI to: ${mirror.active}`);
    } else if (mirror.attempted) {
      this.warn(`Kiro mirror skipped: ${mirror.reason}`);
    }
    // attempted=false (kiro-cli / hermes-agent not installed) is silent —
    // users without those tools don't need noise on every switch.
  }
}
