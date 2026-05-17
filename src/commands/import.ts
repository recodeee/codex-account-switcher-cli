import { Args, Flags, Command } from "@oclif/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ACCOUNTS_DIR = path.join(os.homedir(), ".codex", "accounts");

export default class Import extends Command {
  static description = "Import auth file(s) into managed accounts (single file, directory, or --purge to rebuild registry)";

  static args = {
    path: Args.string({ description: "Path to auth JSON file or directory of .json files" }),
  } as const;

  static flags = {
    alias: Flags.string({ description: "Alias name for the imported account (single file only)" }),
    purge: Flags.boolean({ description: "Rebuild registry from existing auth snapshots in ~/.codex/accounts/" }),
  } as const;

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Import);

    if (flags.purge) {
      this.purgeRebuild(args.path);
      return;
    }

    const target = args.path;
    if (!target) {
      this.error("Provide a path to an auth JSON file or directory.");
    }

    const stat = fs.statSync(target, { throwIfNoEntry: false });
    if (!stat) {
      this.error(`Path not found: ${target}`);
    }

    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });

    if (stat.isDirectory()) {
      this.importDirectory(target);
    } else {
      this.importFile(target, flags.alias);
    }
  }

  private importFile(filePath: string, alias?: string): void {
    const raw = fs.readFileSync(filePath, "utf-8");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.error(`Malformed JSON: ${filePath}`);
      return;
    }

    const name = alias || this.extractName(parsed, filePath);
    const dest = path.join(ACCOUNTS_DIR, `${name}.json`);

    if (fs.existsSync(dest)) {
      this.log(`  Updated: ${name}`);
    } else {
      this.log(`  Imported: ${name}`);
    }
    fs.writeFileSync(dest, raw);
  }

  private importDirectory(dirPath: string): void {
    const files = fs.readdirSync(dirPath).filter((f) => f.endsWith(".json"));
    if (!files.length) {
      this.log(`No .json files found in ${dirPath}`);
      return;
    }
    let count = 0;
    for (const file of files) {
      try {
        this.importFile(path.join(dirPath, file));
        count++;
      } catch (err) {
        this.warn(`Skipped ${file}: ${err}`);
      }
    }
    this.log(`\nImported ${count}/${files.length} files.`);
  }

  private purgeRebuild(scanPath?: string): void {
    const dir = scanPath || ACCOUNTS_DIR;
    if (!fs.existsSync(dir)) {
      this.error(`Directory not found: ${dir}`);
    }
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    this.log(`Rebuilding registry from ${files.length} files in ${dir}...`);

    // Re-import each file to ensure registry consistency
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
    let count = 0;
    for (const file of files) {
      const src = path.join(dir, file);
      const dest = path.join(ACCOUNTS_DIR, file);
      if (src !== dest) {
        fs.copyFileSync(src, dest);
      }
      count++;
    }

    // Also import current auth.json if it exists
    const authJson = path.join(os.homedir(), ".codex", "auth.json");
    if (fs.existsSync(authJson) && !fs.lstatSync(authJson).isSymbolicLink()) {
      const dest = path.join(ACCOUNTS_DIR, "current.json");
      fs.copyFileSync(authJson, dest);
      count++;
    }

    this.log(`Registry rebuilt: ${count} accounts.`);
  }

  private extractName(parsed: Record<string, unknown>, filePath: string): string {
    // Try to extract email from tokens.idToken JWT
    const tokens = parsed.tokens as Record<string, unknown> | undefined;
    if (tokens?.idToken && typeof tokens.idToken === "string") {
      try {
        const payload = JSON.parse(Buffer.from(tokens.idToken.split(".")[1], "base64url").toString());
        if (payload.email) {
          return payload.email.replace(/[^a-z0-9._@-]/gi, "-");
        }
      } catch { /* fall through */ }
    }
    return path.basename(filePath, ".json");
  }
}
