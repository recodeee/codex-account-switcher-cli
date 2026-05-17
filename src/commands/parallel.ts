import { Command, Flags } from "@oclif/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const CLAUDE_PARALLEL_DIR = path.join(os.homedir(), ".claude-accounts");

function getProfiles(): string[] {
  if (!fs.existsSync(CLAUDE_PARALLEL_DIR)) return [];
  return fs.readdirSync(CLAUDE_PARALLEL_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function shellRcPath(): string {
  const shell = process.env.SHELL || "/bin/bash";
  if (shell.includes("zsh")) return path.join(os.homedir(), ".zshrc");
  return path.join(os.homedir(), ".bashrc");
}

export default class ClaudeParallel extends Command {
  static description = "Manage parallel Claude Code accounts via CLAUDE_CONFIG_DIR";

  static flags = {
    add: Flags.string({ description: "Add a new profile name" }),
    remove: Flags.string({ description: "Remove a profile" }),
    aliases: Flags.boolean({ description: "Print shell aliases for all profiles" }),
    install: Flags.boolean({ description: "Install aliases into shell rc file" }),
    list: Flags.boolean({ char: "l", description: "List profiles" }),
  } as const;

  static examples = [
    "agent-auth parallel --add work",
    "agent-auth parallel --add personal",
    "agent-auth parallel --list",
    "agent-auth parallel --aliases",
    "agent-auth parallel --install",
  ];

  async run(): Promise<void> {
    const { flags } = await this.parse(ClaudeParallel);

    if (flags.add) {
      this.addProfile(flags.add);
    } else if (flags.remove) {
      this.removeProfile(flags.remove);
    } else if (flags.install) {
      this.installAliases();
    } else if (flags.aliases) {
      this.printAliases();
    } else {
      this.listProfiles();
    }
  }

  private addProfile(name: string): void {
    const dir = path.join(CLAUDE_PARALLEL_DIR, name);
    if (fs.existsSync(dir)) {
      this.log(`Profile "${name}" already exists at ${dir}`);
      return;
    }
    fs.mkdirSync(dir, { recursive: true });
    this.log(`Created profile: ${name}`);
    this.log(`  Config dir: ${dir}`);
    this.log(`  Run: CLAUDE_CONFIG_DIR=${dir} claude`);
    this.log(`\nTo install shell aliases: agent-auth parallel --install`);
  }

  private removeProfile(name: string): void {
    const dir = path.join(CLAUDE_PARALLEL_DIR, name);
    if (!fs.existsSync(dir)) {
      this.error(`Profile "${name}" not found.`);
    }
    fs.rmSync(dir, { recursive: true });
    this.log(`Removed profile: ${name}`);
  }

  private listProfiles(): void {
    const profiles = getProfiles();
    if (!profiles.length) {
      this.log("No Claude Code parallel profiles configured.");
      this.log("Add one: agent-auth parallel --add <name>");
      return;
    }
    this.log("Claude Code parallel profiles:\n");
    for (const p of profiles) {
      this.log(`  • ${p}  →  ${path.join(CLAUDE_PARALLEL_DIR, p)}`);
    }
    this.log(`\nRun any profile: claude-<name> (after installing aliases)`);
  }

  private generateAliases(): string {
    const profiles = getProfiles();
    if (!profiles.length) return "";
    const lines = [
      "# Claude Code parallel accounts (managed by agent-auth)",
      ...profiles.map((p) =>
        `alias claude-${p}="CLAUDE_CONFIG_DIR=${path.join(CLAUDE_PARALLEL_DIR, p)} command claude"`
      ),
    ];
    return lines.join("\n");
  }

  private printAliases(): void {
    const aliases = this.generateAliases();
    if (!aliases) {
      this.log("No profiles. Add one first: agent-auth parallel --add <name>");
      return;
    }
    this.log(aliases);
  }

  private installAliases(): void {
    const profiles = getProfiles();
    if (!profiles.length) {
      this.error("No profiles. Add one first: agent-auth parallel --add <name>");
    }

    const rc = shellRcPath();
    const marker = "# >>> agent-auth parallel >>>";
    const endMarker = "# <<< agent-auth parallel <<<";
    const block = [marker, this.generateAliases(), endMarker].join("\n");

    let content = "";
    if (fs.existsSync(rc)) {
      content = fs.readFileSync(rc, "utf-8");
      const startIdx = content.indexOf(marker);
      const endIdx = content.indexOf(endMarker);
      if (startIdx !== -1 && endIdx !== -1) {
        content = content.slice(0, startIdx) + content.slice(endIdx + endMarker.length + 1);
      }
    }

    content = content.trimEnd() + "\n\n" + block + "\n";
    fs.writeFileSync(rc, content);
    this.log(`Installed aliases in ${rc}`);
    this.log(`Run: source ${rc}`);
    this.log(`\nAvailable commands:`);
    for (const p of profiles) {
      this.log(`  claude-${p}`);
    }
  }
}
