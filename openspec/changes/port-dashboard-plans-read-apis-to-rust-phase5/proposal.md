## Why

Phase-4 moved request-log and usage analytics APIs behind the Rust runtime bridge. The next migration slice should cover read-only dashboard and plans APIs so core operator views can run through Rust during cutover drills.

## What Changes

- Add Rust proxy handlers for dashboard read APIs:
  - `GET /api/dashboard/overview`
  - `GET /api/dashboard/system-monitor`
- Add Rust proxy handlers for plans read APIs:
  - `GET /api/projects/plans`
  - `GET /api/projects/plans/{plan_slug}`
  - `GET /api/projects/plans/{plan_slug}/runtime`
- Preserve dashboard-auth header forwarding (`cookie`, `authorization`) and query parameter forwarding.
- Keep fail-closed JSON `503` fallback payloads when Python upstream is unreachable.
- Extend Rust runtime tests for dashboard/plans header forwarding, path/query forwarding, and fail-closed behavior.

## Impact

- Rust runtime can now serve read-only dashboard + plans contracts through the Python parity bridge.
- Reduces Python-direct dependency for operator dashboard surfaces during migration drills.
- Keeps migration low-risk and reversible because business logic remains in Python while Rust owns the edge contract surface.
