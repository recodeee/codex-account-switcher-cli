import { Command, Flags } from "@oclif/core";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";

const DATA_DIR = path.join(os.homedir(), ".local/share/kiro-cli");
const DATA_FILE = path.join(DATA_DIR, "data.sqlite3");
const SWITCHER_DIR = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local/share"), "kiro-account-switcher");
const ACTIVE_FILE = path.join(SWITCHER_DIR, "active");

function validName(name: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

export default class KiroLogin extends Command {
  static description = "Run kiro-cli login then save/name the account snapshot for switching";

  static flags = {
    name: Flags.string({ char: "n", description: "Name for this account (skip prompt)" }),
  } as const;

  async run(): Promise<void> {
    const { flags } = await this.parse(KiroLogin);

    // Run kiro-cli login
    this.log("Running kiro-cli login...");
    try {
      execSync("kiro-cli login", { stdio: "inherit" });
    } catch {
      this.error("kiro-cli login failed.");
    }

    // After login, data.sqlite3 exists — convert/save it
    if (!fs.existsSync(DATA_FILE)) {
      this.error(`${DATA_FILE} not found after login.`);
    }

    const stat = fs.lstatSync(DATA_FILE);

    if (stat.isSymbolicLink()) {
      // Already managed — just report which account is active
      const target = fs.readlinkSync(DATA_FILE);
      const name = path.basename(target, ".sqlite3");
      this.log(`Login refreshed account: ${name}`);
      return;
    }

    // Regular file — need to convert to named snapshot
    let name = flags.name;
    if (!name) {
      name = await prompt("Name this Kiro account (e.g. work, personal): ");
    }
    if (!name || !validName(name)) {
      this.error("Invalid name. Use only letters, numbers, hyphens, underscores, and dots.");
    }

    const target = path.join(DATA_DIR, `${name}.sqlite3`);
    if (fs.existsSync(target)) {
      this.error(`${target} already exists. Pick a different name.`);
    }

    fs.renameSync(DATA_FILE, target);
    fs.symlinkSync(target, DATA_FILE);
    fs.mkdirSync(SWITCHER_DIR, { recursive: true });
    fs.writeFileSync(ACTIVE_FILE, name);
    this.log(`Saved as ${name}.sqlite3 and symlinked.`);
  }
}
