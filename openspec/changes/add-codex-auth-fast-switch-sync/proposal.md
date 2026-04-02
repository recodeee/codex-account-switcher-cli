## Why

Operators who juggle multiple Codex accounts currently perform a slow multi-step flow:

1. run `codex-auth use <name>`
2. manually upload the selected snapshot into codex-lb
3. repeat dashboard login/TOTP when required

The friction discourages keeping codex-lb account entries fresh after token refreshes.

## What Changes

- Add new operator CLI commands: `codex-lb-switch` and `codex-lb-sync-all`.
- `codex-lb-switch` runs `codex-auth use <name>` and immediately imports `~/.codex/accounts/<name>.json` into codex-lb.
- `codex-lb-sync-all` imports all `~/.codex/accounts/*.json` snapshots in one run.
- `codex-lb-sync-all` also imports the active `~/.codex/auth.json` snapshot from `codex login` when present.
- Dashboard accounts UI adds a per-account **Use this** action that executes `codex-auth use <snapshot>` on the host.
- `GET /api/accounts` and `GET /api/dashboard/overview` auto-import local codex snapshots so newly logged-in accounts show up in dashboard account views without manual upload.
- Support dashboard-auth-protected environments by logging in via password and optional TOTP when needed.
- Document the fast-switch flow in the README.

## Impact

- Switching and syncing an account becomes one command.
- Token refresh workflows become much faster and less error-prone.
- No changes to proxy request routing logic or account selection strategy.
