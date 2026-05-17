import { Command } from "@oclif/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CODEX_DIR = path.join(os.homedir(), ".codex");
const ACCOUNTS_DIR = path.join(CODEX_DIR, "accounts");

export default class Clean extends Command {
  static description = "Delete managed backup and stale account files";

  async run(): Promise<void> {
    let cleaned = 0;

    // Remove .bak files in accounts dir
    if (fs.existsSync(ACCOUNTS_DIR)) {
      for (const file of fs.readdirSync(ACCOUNTS_DIR)) {
        if (file.endsWith(".bak") || file.endsWith(".backup")) {
          fs.unlinkSync(path.join(ACCOUNTS_DIR, file));
          this.log(`  Removed: accounts/${file}`);
          cleaned++;
        }
      }
    }

    // Remove auth.json.bak in .codex root
    const authBak = path.join(CODEX_DIR, "auth.json.bak");
    if (fs.existsSync(authBak)) {
      fs.unlinkSync(authBak);
      this.log(`  Removed: auth.json.bak`);
      cleaned++;
    }

    // Remove broken symlinks in accounts dir
    if (fs.existsSync(ACCOUNTS_DIR)) {
      for (const file of fs.readdirSync(ACCOUNTS_DIR)) {
        const full = path.join(ACCOUNTS_DIR, file);
        if (fs.lstatSync(full).isSymbolicLink() && !fs.existsSync(full)) {
          fs.unlinkSync(full);
          this.log(`  Removed broken symlink: accounts/${file}`);
          cleaned++;
        }
      }
    }

    if (cleaned === 0) {
      this.log("Nothing to clean.");
    } else {
      this.log(`\nCleaned ${cleaned} file(s).`);
    }
  }
}
