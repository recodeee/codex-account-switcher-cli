## Why

Phase-3 established live-usage parity behavior in the Rust runtime. The next migration wave is request-log and usage API parity so dashboard analytics can be served through the Rust layer during cutover drills.

## What Changes

- Add Rust proxy handlers for the request-log API family:
  - `GET /api/request-logs`
  - `GET /api/request-logs/options`
  - `GET /api/request-logs/usage-summary`
- Add Rust proxy handlers for the usage API family:
  - `GET /api/usage/summary`
  - `GET /api/usage/history`
  - `GET /api/usage/window`
- Forward dashboard-auth headers (cookie/authorization) and query parameters upstream.
- Return fail-closed JSON `503` fallback payloads when Python upstream is unreachable.
- Extend Rust runtime tests for auth-header forwarding, query forwarding, and fail-closed behavior.

## Impact

- Rust runtime can serve dashboard request-log + usage API contracts via upstream parity bridge.
- Enables Phase-4 migration gates without immediate native Rust business-logic reimplementation.
- Preserves operational safety via explicit fail-closed behavior when upstream is unavailable.
