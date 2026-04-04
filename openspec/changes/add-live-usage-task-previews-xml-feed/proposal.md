## Why

Operators using the lightweight `GET /live_usage` XML feed can see per-snapshot session counts, but cannot see the current CLI task previews tied to those sessions.

When debugging MCP/runtime attribution, this makes it hard to confirm whether an active snapshot's sessions match the expected task workload.

## What Changes

- Extend `GET /live_usage` XML output with task-preview observability metadata.
- Add `total_task_previews` on the root `<live_usage>` node.
- Add per-snapshot task-preview rows:
  - `task_preview_count` attribute on `<snapshot>` when task previews exist.
  - nested `<task_preview account_id="..." preview="..." />` entries.
- Keep output backward-compatible for snapshots that have no task previews.

## Impact

- Better on-call visibility in the existing XML feed used by MCP/watch tooling.
- Easier to validate that live sessions match the currently running CLI tasks.
- Additive schema extension only (no endpoint/path change).
