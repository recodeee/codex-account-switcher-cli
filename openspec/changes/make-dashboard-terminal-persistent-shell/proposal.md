## Why
The dashboard terminal currently launches a one-shot shell command (`codex`) and exits immediately when that command fails (for example, `codex: command not found`). This feels unlike a real terminal and blocks in-session recovery.

## What Changes
- Launch account terminal sessions as interactive login shells that stay open until the user exits.
- Auto-run the configured startup command after shell start instead of making that command the shell process itself.
- Redesign the terminal modal chrome and viewport to look and behave like a real terminal window.

## Impact
- Operators can recover in-place when startup command fails instead of reopening the modal.
- Dashboard terminal UX is closer to native terminal behavior.
- No API route changes and no quota/routing behavior changes.
