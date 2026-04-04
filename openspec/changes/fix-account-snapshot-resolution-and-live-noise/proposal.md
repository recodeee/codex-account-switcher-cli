## Why

Operators reported two high-friction account UX issues:

1. Some accounts resolve to the wrong local snapshot name when multiple snapshots
   share similar metadata, causing account cards to show incorrect team context.
2. Starting new Codex sessions can surface unrelated accounts as "working now"
   due to default-session fingerprint spreading when process attribution is not available.

## What Changes

- Prefer email-aligned snapshot names when resolving `codexAuth.snapshotName` for an account.
- Keep default-session fingerprint spreading opt-in (disabled by default) to avoid random cross-account "working now" attribution.

## Impact

- Account cards resolve to the expected snapshot for the selected email.
- "Working now" reflects active snapshot/process attribution more conservatively by default.
