## Why
Dashboard account cards currently do not show the linked `codex-auth` snapshot name, so operators must navigate elsewhere to verify local mapping before switching or troubleshooting.

## What Changes
- Show snapshot mapping inline in Dashboard card subtitle using existing account payload fields.
- Render `<Plan Label> · <snapshotName>` when a mapped snapshot is available.
- Render `<Plan Label> · No snapshot` when no mapped snapshot exists.

## Impact
- Faster operator diagnosis directly from Dashboard.
- Frontend-only presentation update; no API contract changes.
