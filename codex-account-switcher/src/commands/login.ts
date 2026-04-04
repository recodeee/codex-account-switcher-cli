import { Args, Flags } from "@oclif/core";
import { spawn } from "node:child_process";
import { BaseCommand } from "../lib/base-command";
import { CodexAuthError } from "../lib/accounts";
import { parseAuthSnapshotFile } from "../lib/accounts/auth-parser";
import { resolveAuthPath } from "../lib/config/paths";

export default class LoginCommand extends BaseCommand {
  static description =
    "Run `codex login` and save the resulting ~/.codex/auth.json as a named account (or infer one from auth email)";

  static args = {
    name: Args.string({
      name: "name",
      required: false,
      description: "Optional account snapshot name. If omitted, inferred from auth email",
    }),
  } as const;

  static flags = {
    "device-auth": Flags.boolean({
      description: "Pass through to `codex login --device-auth`",
      default: false,
    }),
    force: Flags.boolean({
      char: "f",
      description:
        "Force overwrite when the existing snapshot name belongs to a different detected account identity",
      default: false,
    }),
  } as const;

  async run(): Promise<void> {
    await this.runSafe(async () => {
      const { args, flags } = await this.parse(LoginCommand);
      const providedName = args.name as string | undefined;

      await this.runCodexLogin(Boolean(flags["device-auth"]));
      await this.waitForCodexAuthSnapshot();

      const resolvedName = providedName
        ? { name: providedName, source: "explicit" as const }
        : await this.accounts.resolveDefaultAccountNameFromCurrentAuth();
      const savedName = await this.accounts.saveAccount(resolvedName.name, {
        force: Boolean(flags.force),
      });

      const suffix =
        resolvedName.source === "explicit"
          ? ""
          : resolvedName.source === "active"
            ? " (reused active account name)"
            : " (inferred from auth email)";
      this.log(`Saved current Codex auth tokens as "${savedName}"${suffix}.`);
    });
  }

  private async runCodexLogin(deviceAuth: boolean): Promise<void> {
    const loginArgs = deviceAuth ? ["login", "--device-auth"] : ["login"];

    await new Promise<void>((resolve, reject) => {
      const child = spawn("codex", loginArgs, {
        stdio: "inherit",
      });

      child.on("error", (error) => {
        const err = error as NodeJS.ErrnoException;
        if (err.code === "ENOENT") {
          reject(
            new CodexAuthError(
              "`codex` CLI was not found in PATH. Install Codex CLI first, then retry.",
            ),
          );
          return;
        }
        reject(error);
      });

      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        if (typeof code === "number") {
          reject(new CodexAuthError(`\`codex ${loginArgs.join(" ")}\` failed with exit code ${code}.`));
          return;
        }

        reject(new CodexAuthError(`\`codex ${loginArgs.join(" ")}\` was terminated by signal ${signal ?? "unknown"}.`));
      });
    });
  }

  private async waitForCodexAuthSnapshot(): Promise<void> {
    const authPath = resolveAuthPath();
    const timeoutMs = 5_000;
    const pollMs = 200;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() <= deadline) {
      const parsed = await parseAuthSnapshotFile(authPath);
      if (parsed.authMode !== "unknown") {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }

    throw new CodexAuthError(
      "Timed out waiting for refreshed Codex auth snapshot after login. Retry `codex-auth login`.",
    );
  }
}
