## ADDED Requirements

### Requirement: One-command codex-auth switch and codex-lb sync

The project SHALL provide a CLI command `codex-lb-switch` that enables operators to switch their local Codex account snapshot and sync it into codex-lb in one command.

The command MUST:

- run `codex-auth use <name>`;
- load `~/.codex/accounts/<name>.json`;
- import that snapshot via `POST /api/accounts/import` on the configured codex-lb URL.

#### Scenario: Successful switch and sync

- **WHEN** `codex-lb-switch work` is executed and dashboard auth is not required
- **THEN** the command switches the local codex-auth snapshot to `work`
- **AND** imports `~/.codex/accounts/work.json` into codex-lb
- **AND** exits successfully

#### Scenario: Dashboard password protection

- **WHEN** dashboard auth is enabled and `codex-lb-switch` is invoked with a valid password
- **THEN** the command authenticates through `/api/dashboard-auth/password/login`
- **AND** proceeds to import the snapshot

#### Scenario: Dashboard TOTP protection

- **WHEN** dashboard auth requires TOTP and the command receives a valid TOTP code (directly or via a generation command)
- **THEN** the command verifies TOTP through `/api/dashboard-auth/totp/verify`
- **AND** imports the snapshot successfully

#### Scenario: Missing snapshot

- **WHEN** the named codex-auth snapshot file does not exist
- **THEN** the command fails with an actionable message instructing the operator to run `codex-auth save <name>` first

### Requirement: Bulk snapshot sync

The project SHALL provide a CLI command `codex-lb-sync-all` that imports every `*.json` snapshot from the configured codex-auth accounts directory into codex-lb.

#### Scenario: Bulk sync all snapshots

- **WHEN** `codex-lb-sync-all` is executed and snapshots exist in `~/.codex/accounts`
- **THEN** each snapshot is imported through `POST /api/accounts/import`
- **AND** the command prints a summary with imported and failed counts

#### Scenario: Include active codex login snapshot

- **WHEN** `~/.codex/auth.json` exists from a recent `codex login`
- **THEN** `codex-lb-sync-all` includes that snapshot in the import run
- **AND** does not duplicate imports when `auth.json` points to an existing account snapshot file

#### Scenario: No snapshots found

- **WHEN** `codex-lb-sync-all` runs and no snapshot files exist in the source directory
- **THEN** the command fails with an actionable message

### Requirement: Dashboard per-account local codex-auth switch

The dashboard SHALL expose a per-account action that switches the host's active Codex login using `codex-auth use <snapshot>`.

#### Scenario: Use this action is enabled only with 5h quota and snapshot

- **WHEN** an account has `primary_remaining_percent > 0` and a matched codex-auth snapshot
- **THEN** the dashboard shows **Use this** as enabled/green for that account
- **AND** clicking it triggers local `codex-auth use <snapshot>`

#### Scenario: Use this action is disabled without 5h quota or snapshot

- **WHEN** `primary_remaining_percent` is missing/zero OR no matched codex-auth snapshot exists
- **THEN** the dashboard shows **Use this** as disabled/gray
- **AND** provides an explanatory reason
