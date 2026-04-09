## Why

We already have Rust health endpoints and parity tooling, but the Rust layer still lacks a runtime-aware bridge signal for Python-backed health semantics. During strangler migration, operators need one Rust endpoint that explicitly reports whether the underlying Python layer is healthy before cutover decisions.

## What Changes

- Add a Rust endpoint `GET /_python_layer/health` that probes Python `/health`, `/health/live`, `/health/ready`, and `/health/startup`.
- Add a Rust endpoint `GET /_python_layer/apis` that reads Python `openapi.json` and exposes discovered path names for runtime UI.
- Return fail-closed status from Rust: HTTP `200` when all probes succeed, HTTP `503` when any probe fails.
- Add configurable Python bridge settings via environment:
  - `PYTHON_RUNTIME_BASE_URL`
  - `RUST_RUNTIME_PYTHON_TIMEOUT_MS`
- Extend Rust runtime tests to cover healthy and degraded Python-bridge behavior.
- Update the Rust root runtime panel to always render live Python API links from `/_python_layer/apis`.

## Impact

- Makes the Rust layer explicitly aware of Python-layer health without changing traffic routing.
- Improves operational readiness for staged migration/canary decisions.
- Keeps rollback trivial because the change is additive and probe-only.
