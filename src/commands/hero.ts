import { Command } from "@oclif/core";

export default class Hero extends Command {
  static description = "Show usage tutorial and quick-start guide";
  static hidden = true;

  async run(): Promise<void> {
    this.log(`
  \x1b[1m\x1b[36m╭─────────────────────────────────────────────────────╮\x1b[0m
  \x1b[1m\x1b[36m│\x1b[0m  🔐 \x1b[1magent-auth\x1b[0m                                       \x1b[1m\x1b[36m│\x1b[0m
  \x1b[1m\x1b[36m│\x1b[0m  Multi-account manager for AI CLI agents             \x1b[1m\x1b[36m│\x1b[0m
  \x1b[1m\x1b[36m│\x1b[0m  Claude Code · Codex · Kiro CLI                      \x1b[1m\x1b[36m│\x1b[0m
  \x1b[1m\x1b[36m╰─────────────────────────────────────────────────────╯\x1b[0m

  \x1b[2m─── Quick Start ───────────────────────────────────────\x1b[0m

  \x1b[33m$\x1b[0m agent-auth save work          \x1b[2mSnapshot current session\x1b[0m
  \x1b[33m$\x1b[0m agent-auth login personal     \x1b[2mLogin + save in one step\x1b[0m
  \x1b[33m$\x1b[0m agent-auth use work           \x1b[2mSwitch active account\x1b[0m
  \x1b[33m$\x1b[0m agent-auth use                \x1b[2mInteractive picker\x1b[0m
  \x1b[33m$\x1b[0m agent-auth list               \x1b[2mAll accounts + usage %\x1b[0m

  \x1b[2m─── Parallel Claude Code ──────────────────────────────\x1b[0m

  \x1b[33m$\x1b[0m agent-auth parallel --add work
  \x1b[33m$\x1b[0m agent-auth parallel --add personal
  \x1b[33m$\x1b[0m agent-auth parallel --install
  \x1b[2m  → Then run\x1b[0m \x1b[1mclaude-work\x1b[0m \x1b[2mand\x1b[0m \x1b[1mclaude-personal\x1b[0m \x1b[2min separate tabs\x1b[0m

  \x1b[2m─── Kiro CLI ─────────────────────────────────────────\x1b[0m

  \x1b[33m$\x1b[0m agent-auth kiro               \x1b[2mSwitch Kiro accounts\x1b[0m
  \x1b[33m$\x1b[0m agent-auth kiro-login         \x1b[2mAdd new Kiro account\x1b[0m

  \x1b[2m─── More ─────────────────────────────────────────────\x1b[0m

  \x1b[33m$\x1b[0m agent-auth config             \x1b[2mAuto-switch thresholds\x1b[0m
  \x1b[33m$\x1b[0m agent-auth status             \x1b[2mService & usage status\x1b[0m
  \x1b[33m$\x1b[0m agent-auth remove             \x1b[2mDelete saved accounts\x1b[0m
  \x1b[33m$\x1b[0m agent-auth update             \x1b[2mCheck for new version\x1b[0m
  \x1b[33m$\x1b[0m agent-auth --help             \x1b[2mFull command reference\x1b[0m
`);
  }
}
