## Why

Workspace accounts that were previously downgraded to a disconnected/free state stay stale even after the local Codex auth snapshot shows that the account is back on the paid team/workspace again.

Operators want those accounts to recover silently during normal dashboard/accounts polling so the token card reflects the current quota/token state without requiring a manual repair or re-import step.

## What Changes

- Let codex-auth auto-import silently reactivate a workspace-disconnected account when a validated local snapshot now reports a non-free/team-capable plan again.
- Keep the existing downgrade shield for accounts that are still removed from the workspace.
- Expose backend-authored codex-auth runtime readiness metadata so dashboard/account payloads can tell when the selected snapshot is validated for the account email.
- Cover the recovery path with account-list and dashboard-overview regressions.

## Impact

- Previously disconnected workspace accounts can recover automatically once local Codex auth is back on the team plan.
- Dashboard polling can refresh quota/token windows again without a manual operator step.
- Existing protections against stale cross-account session attribution and free-tier downgrade leakage remain in place.
