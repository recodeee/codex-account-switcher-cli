## Why

Live quota percentages can oscillate upward on refresh when concurrent terminals for the same account report inconsistent snapshots. This causes 5h/weekly bars to flash up/down even though consumed usage should be monotonic within a reset window.

## What Changes

- Add frontend quota-display stabilization that keeps the lowest observed remaining percent per account/window within the same reset cycle.
- Reset the floor automatically when the window reset timestamp changes.
- Apply stabilized values across dashboard cards and accounts list/detail views.
- For runtime-profile session telemetry, aggregate concurrent session files per snapshot/window using the highest observed `used_percent` within the same active cycle (equivalent to lowest remaining).
- Expose per-account debug telemetry (raw terminal samples + merged selection) in API/card overlay and add env-gated merge decision logs for diagnosis.
- Add test coverage for floor behavior and reset-cycle rollover.

## Impact

- 5h and weekly quota visuals stop flashing upward within a cycle.
- Multi-terminal jitter no longer inflates apparent remaining quota.
- Debugging mismatches is faster with card-level raw/merged telemetry visibility and opt-in server logs.
- Values can increase again after a real reset cycle transition.
