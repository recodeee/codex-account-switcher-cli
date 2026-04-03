## Why

Dashboard account cards can show stale `codexSessionCount` and stale 5h/weekly quota values when the currently active local Codex snapshot has fresher rollout telemetry than the persisted database rows.

## What Changes

- Add a local rollout parser that reads recent `.codex/sessions/**/rollout-*.jsonl` files and extracts:
  - active session count (recent rollout files),
  - latest primary/secondary rate-limit windows.
- Apply this live telemetry as an override for accounts resolved as `codexAuth.isActiveSnapshot` in:
  - dashboard overview responses,
  - accounts list responses.

## Expected Outcome

- Active snapshot cards show current session count and current 5h/weekly percentages instead of stale persisted values.
- Non-active snapshot accounts keep existing DB-backed behavior.

