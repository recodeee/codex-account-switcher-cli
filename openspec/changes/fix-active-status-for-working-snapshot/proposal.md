## Why
Dashboard and Accounts UI can show `Deactivated` even when Codex auth indicates the account is currently the active local snapshot (`codexAuth.isActiveSnapshot = true`). This is misleading because the account is already authenticated and in active use.

## What Changes
- Add an effective status resolver that treats `deactivated` + active snapshot as `active` for UI status gating.
- Apply the effective status to status badges and action gating for Dashboard cards and Accounts list/actions.
- Keep backend/source status unchanged; this is a UI state interpretation fix.
- Add regression tests covering the active-snapshot override behavior.

## Impact
- Accounts currently in use no longer appear deactivated.
- `Use this` and related UI actions are enabled when a deactivated account is already the active snapshot and has quota.
- Re-auth actions are hidden for active-snapshot accounts.
