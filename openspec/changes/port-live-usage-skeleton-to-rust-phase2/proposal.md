## Why

To continue the Python-to-Rust migration safely, we need a small observable slice beyond health checks.
`/live_usage` and `/live_usage/mapping` are diagnostic endpoints used during runtime investigations, and adding Rust-owned baseline versions creates room for iterative parity hardening.

## What Changes

- Add Rust endpoints for `GET /live_usage` and `GET /live_usage/mapping`.
- Return XML payloads with Python-aligned root tags/summary attributes and `Cache-Control: no-store`.
- Start with zero-session skeleton payloads (safe baseline) while preserving explicit migration notes.

## Impact

- Rust layer can now serve a second endpoint family beyond health.
- Enables incremental parity work on live-usage observability without traffic cutover risk.
- Keeps behavior reversible and low-risk because responses are clearly scoped skeleton contracts.
