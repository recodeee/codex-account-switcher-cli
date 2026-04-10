## Why

Phase-7 drain controls moved shutdown gating into Rust runtime, but background scheduler lifecycle (start/stop/shutdown orchestration) still lives in Python lifespan wiring. For full Python->Rust replacement, Rust needs a first-class scheduler lifecycle module with Python-parity semantics before integrator wiring in `main.rs`.

## What Changes

- Add Rust runtime scheduler lifecycle modules under `rust/codex-lb-runtime/src/runtime/**`.
- Implement Python-parity lifecycle behavior for background jobs:
  - idempotent start,
  - enabled/disabled gating,
  - stop via stop-signal + task cancellation,
  - shutdown stop order in reverse registration order.
- Add regression tests for lifecycle parity (start/stop/shutdown behavior).
- Provide handoff integration notes for `main.rs` wiring (without editing `main.rs` in this wave).

## Impact

- Rust runtime owns scheduler lifecycle internals needed for full cutover.
- Integration remains low-risk because wildcard proxy posture and current Python behavior remain unchanged until integrator wiring.
- No Python removal in this wave.
