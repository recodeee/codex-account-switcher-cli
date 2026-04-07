# codex-auth

A command-line tool that lets you manage and switch between multiple Codex accounts instantly, no more constant logins and logouts.

> [!WARNING]
> Not affiliated with OpenAI or Codex. Not an official tool.

## How it Works

Codex stores your authentication session in a single `auth.json` file. This tool works by creating named snapshots of that file for each of your accounts. When you want to switch, `codex-auth` swaps the active `~/.codex/auth.json` with the snapshot you select, instantly changing your logged-in account.

## Requirements

- Node.js 18 or newer

## Install (npm)

```sh
npm i -g @imdeadpool/codex-account-switcher
```

During global install, the package asks for permission to add an optional shell hook
(`~/.bashrc` or `~/.zshrc`) that auto-runs a silent snapshot sync after successful
official `codex login`.

- Choose `y` to enable fully automatic login snapshot capture.
- Choose `n` (default) to skip.
- Set `CODEX_AUTH_SKIP_POSTINSTALL=1` to always suppress this prompt.

## Usage

```sh
# login to Codex and immediately snapshot the refreshed auth session
codex-auth login [name]

# headless/remote login flow + snapshot
codex-auth login [name] --device-auth

# force overwrite when reusing a name across different detected identities
codex-auth login [name] --force

# save the current logged-in token as a named account
codex-auth save <name>

# force overwrite a name even when it currently maps to a different email
codex-auth save <name> --force

# switch active account
codex-auth use <name>

# or pick interactively
codex-auth use

# list accounts
codex-auth list

# list accounts with mapping metadata (email/account/user/usage)
codex-auth list --details

# show current account name
codex-auth current

# check for a newer release and update globally
codex-auth self-update

# check only (no install)
codex-auth self-update --check

# reinstall latest even if already up to date
codex-auth self-update --reinstall

# remove accounts (interactive multi-select)
codex-auth remove

# remove by selector or all
codex-auth remove <query>
codex-auth remove --all

# show auto-switch + service status
codex-auth status

# auto-switch configuration
codex-auth config auto enable
codex-auth config auto disable
codex-auth config auto --5h 12 --weekly 8

# usage source configuration
codex-auth config api enable
codex-auth config api disable

# daemon runtime (internal/service use)
codex-auth daemon --once
codex-auth daemon --watch

# optional shell hook helpers
codex-auth setup-login-hook
codex-auth hook-status
codex-auth remove-login-hook
```

### Command reference

- `codex-auth save <name> [--force]` – Validates `<name>`, ensures `auth.json` exists, then snapshots it to `~/.codex/accounts/<name>.json`. By default, it blocks overwriting a name when the existing snapshot email differs from current auth. If `name` is omitted, it first tries reusing the active snapshot name when identity matches; otherwise it infers one from auth email.
- `codex-auth login [name] [--device-auth] [--force]` – Runs `codex login` (optionally with device auth), waits for refreshed auth snapshot detection, then saves it. If `name` is omitted, it always infers one from auth email with unique-suffix handling for multi-workspace identities.
- `codex-auth use [name]` – Accepts a name or launches an interactive selector with the current account pre-selected, writes `~/.codex/auth.json` as a regular file from the chosen snapshot, and records the active name.
- `codex-auth list [--details]` – Lists all saved snapshots alphabetically and marks the active one with `*`. `--details` adds per-snapshot mapping metadata (email, account id, user id, and usage metadata) for easier session/account troubleshooting.
- `codex-auth current` – Prints the active account name, or a friendly message if none is active.
- `codex-auth self-update [--check] [--reinstall] [-y]` – Checks npm for newer release metadata. `--check` prints current/latest/status only. `--reinstall` forces reinstall even when already up to date. `-y` skips confirmation prompts.
- `codex-auth remove [query|--all]` – Removes snapshots interactively or by selector. If the active account is removed, the best remaining account is activated automatically.
- `codex-auth status` – Prints auto-switch state, managed service status, active thresholds, and usage mode.
- `codex-auth config auto ...` – Enables/disables managed auto-switch and updates threshold percentages.
- `codex-auth config api enable|disable` – Chooses usage source mode (`api` or `local`).
- `codex-auth daemon --once|--watch` – Runs the auto-switch loop once or continuously.
- `codex-auth setup-login-hook [-f <path>]` – Installs an optional shell hook in your rc file to auto-sync snapshots after successful official `codex login`.
- `codex-auth hook-status [-f <path>]` – Shows whether the optional login auto-snapshot hook is installed for the selected rc file.
- `codex-auth remove-login-hook [-f <path>]` – Removes the optional shell hook.

### Auto-switch behavior

When auto-switch is enabled, the daemon evaluates the active account and switches when either threshold is crossed:

- `5h` remaining `< threshold5h` (default `10%`)
- `weekly` remaining `< thresholdWeekly` (default `5%`)

Usage refresh is hybrid:

1. API mode (`config api enable`): query ChatGPT usage endpoint for each account.
2. Local fallback: active account usage can fall back to local session rollout logs when API data is unavailable.

### Managed background service

`codex-auth config auto enable` installs a managed watcher per OS:

- Linux: user `systemd` service
- macOS: LaunchAgent
- Windows: Scheduled Task

`codex-auth status` reports whether the managed watcher is active.

Notes:

- Works on macOS/Linux/Windows (regular-file auth snapshot activation).
- Requires Node 18+.
- Running bare `codex-auth` shows the help screen and also displays an update notice when a newer npm release is available.
