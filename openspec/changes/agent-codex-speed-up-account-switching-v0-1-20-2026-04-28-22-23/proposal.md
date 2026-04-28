# Speed up account switching and prepare v0.1.20

## Why

Manual npm publish failed because `0.1.19` already exists. The next release should move to `0.1.20` and keep account switching responsive when official `codex login` refreshes an existing saved account.

## What changes

- Reuse registry account metadata to resolve matching relogin snapshots before parsing every saved account file.
- Record direct switch session account and auth fingerprint in one session-map update.
- Bump npm package metadata to `0.1.20`.
- Add `releases/v0.1.20.md` with publish-ready notes.

## Verification

- `npm test --silent`
- `npm pack --dry-run`
- `openspec validate agent-codex-speed-up-account-switching-v0-1-20-2026-04-28-22-23 --strict`
