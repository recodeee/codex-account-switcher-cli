## Why
Dashboard accounts can map to codex-auth snapshots whose names no longer match the account email. That mismatch makes local auth state harder to audit and causes confusion in the plugin UI.

## What Changes
- Add an account API action to repair snapshot naming with two modes:
  - `readd`: copy the currently resolved snapshot to the email-derived canonical snapshot name.
  - `rename`: move the currently resolved snapshot to the email-derived canonical snapshot name.
- Keep active local pointers (`current`, `auth.json`, registry active snapshot) aligned to the repaired snapshot.
- Expose mismatch metadata in account `codexAuth` status (`expectedSnapshotName`, `snapshotNameMatchesEmail`).
- Add UI actions in Accounts and Dashboard cards for mismatched snapshots:
  - `Re-add snapshot`
  - `Rename snapshot`

## Impact
- Operators can fix mismatched snapshot naming directly from the dashboard plugin.
- No behavior change for accounts that are already aligned.
- Conflicts are explicit and non-destructive when target snapshot names already exist.
