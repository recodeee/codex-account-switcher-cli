## Why

Phase-2 introduced Rust-owned `/live_usage` and `/live_usage/mapping` skeletons, but those responses do not yet reflect real session/account attribution and task-preview behavior. For Phase-3, we need runtime parity behavior now while we continue deeper native Rust porting.

## What Changes

- Upgrade Rust `GET /live_usage` and `GET /live_usage/mapping` to proxy Python live-usage XML endpoints for behavior parity.
- Preserve mapping query parameters (for example `?minimal=true`) when proxying.
- Keep Rust no-store XML fallback payloads for degraded Python reachability so diagnostics remain available.
- Extend Rust runtime tests to validate upstream XML passthrough and query forwarding.
- Extend runtime parity tooling to compare XML contracts with dynamic `generated_at` normalization.

## Impact

- Rust layer now returns production-shaped live-usage XML when Python is reachable.
- Phase-3 parity gate can proceed with lower contract drift risk before native Rust reimplementation.
- Fallback keeps observability resilient during local/offline development and partial outage scenarios.
