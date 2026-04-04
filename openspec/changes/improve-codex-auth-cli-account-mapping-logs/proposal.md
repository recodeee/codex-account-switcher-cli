## Why

`codex-auth list` currently prints only snapshot names. Operators cannot quickly see which saved snapshot maps to which ChatGPT account identity (email/account/user), making troubleshooting session/account mapping harder.

## What Changes

- Add a detailed list mode for `codex-auth list` that prints per-snapshot mapping metadata (email, account id, user id, and usage source/timestamp when available).
- Keep default `codex-auth list` output unchanged for backwards compatibility.
- Update README command reference with the new detailed list flag.

## Impact

- Improves CLI visibility into account-session mapping state.
- Reduces ambiguity when verifying which snapshot corresponds to which account identity.
- No breaking changes to existing command defaults.
