## Why

Dashboard account cards can drift from the actual local Codex runtime state:

- Live 5h/weekly usage overrides are currently in-memory only, so refreshed views can fall back to stale DB rows.
- Card token totals can be over-counted when a usage row has unknown (`null`) remaining percentage.
- Card session counts can include non-live sticky fallback values instead of showing "active now" only.

## What Changes

- Persist applied local live usage overrides (primary/secondary) into `usage_history` per account when telemetry is newer and materially changed.
- Keep persistence idempotent by skipping writes when the latest stored row already matches live values or is newer.
- Update dashboard account-card token derivation to ignore unknown usage rows (`remainingPercentAvg == null`) and fall back to request-usage totals.
- Update dashboard card session metric semantics to show active-now sessions only (telemetry-confirmed live session), while leaving sessions-page behavior unchanged.
- Show per-window stale "last seen" labels on dashboard quota bars when live telemetry is not currently active.

## Impact

- Dashboard cards retain current per-account token/quota windows across refreshes.
- Session counts on cards communicate active runtime state instead of historical sticky session residue.
- Unknown usage windows no longer inflate token totals.
