## Why
Codex auth auto-import can rewrite a different account's email-shaped snapshot filename with the active auth payload when multiple accounts share the same ChatGPT account id. This corrupts on-disk snapshot ownership and causes dashboard accounts to look locked because their filename no longer matches the embedded auth email.

## What Changes
- Restrict auto-import alias refresh so it only rewrites safe aliases for the active identity.
- Continue refreshing the canonical email snapshot, canonical `--dup-N` aliases, and generic non-email legacy aliases.
- Stop rewriting foreign email-shaped aliases that belong to a different email identity.
- Add regression coverage for the foreign-email-alias corruption case.

## Impact
- Auto-import no longer steals another email-shaped snapshot filename during refresh.
- Existing canonical and generic alias refresh behavior stays intact for the same identity.
- Dashboard accounts stop losing their snapshot mapping because of auto-import alias corruption.
