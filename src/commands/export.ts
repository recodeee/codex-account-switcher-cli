import { Args, Command } from "@oclif/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ACCOUNTS_DIR = path.join(os.homedir(), ".codex", "accounts");

export default class Export extends Command {
  static description = "Export stored account auth files to a directory";

  static args = {
    dir: Args.string({ description: "Target directory (default: ./agent-auth-export/)" }),
  } as const;

  async run(): Promise<void> {
    const { args } = await this.parse(Export);
    const targetDir = args.dir || path.join(process.cwd(), "agent-auth-export");

    if (!fs.existsSync(ACCOUNTS_DIR)) {
      this.error("No accounts found in ~/.codex/accounts/");
    }

    const files = fs.readdirSync(ACCOUNTS_DIR).filter((f) => f.endsWith(".json"));
    if (!files.length) {
      this.error("No account snapshots to export.");
    }

    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(path.join(ACCOUNTS_DIR, file), path.join(targetDir, file));
    }
    this.log(`Exported ${files.length} accounts to ${targetDir}`);
  }
}
