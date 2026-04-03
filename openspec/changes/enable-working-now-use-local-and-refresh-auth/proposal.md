## Why
Working-now accounts can still show a disabled **Use this account** action when 5h quota telemetry is stale or at zero, even though those accounts are actively serving Codex sessions. This blocks quick switching to the account that is already in use.

Also, re-auth currently relies on local snapshot switching or full OAuth login. We already have refresh-token infrastructure compatible with CodexBar behavior, so we can attempt token refresh without forcing interactive login.

## What Changes
- Update local switch gating so **Use this / Use this account** is always enabled for accounts detected as **working now**.
- Keep existing active+quota gating for non-working accounts.
- Add backend API `POST /api/accounts/{accountId}/refresh-auth` that refreshes stored account tokens using refresh-token grant (no interactive login).
- Update UI re-auth actions to try `refresh-auth` first, with existing fallbacks when refresh fails.

## Impact
- Faster local switching for actively working accounts.
- Fewer unnecessary OAuth re-login flows.
- Preserves existing remediation paths when refresh cannot recover credentials.
