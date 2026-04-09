## 1. Specification

- [x] 1.1 Add OpenSpec change `port-health-slice-to-rust-runtime-phase1` for Python-bridge health rollup in Rust.
- [x] 1.2 Define fail-closed and configuration scenarios for bridge probing.

## 2. Implementation

- [x] 2.1 Add Rust endpoint `GET /_python_layer/health` with per-endpoint probe details.
- [x] 2.2 Add runtime configuration support for `PYTHON_RUNTIME_BASE_URL` and `RUST_RUNTIME_PYTHON_TIMEOUT_MS`.
- [x] 2.3 Add Rust endpoint `GET /_python_layer/apis` with OpenAPI-derived Python route listing.
- [x] 2.4 Extend root runtime panel to always display live Python API links from `/_python_layer/apis`.
- [x] 2.5 Extend Rust unit tests for healthy and degraded bridge + API-catalog outcomes.
- [x] 2.6 Update rust runtime README usage notes for Python bridge endpoints.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `python scripts/rust_runtime/compare_runtime.py --help`.
- [x] 3.3 Run `openspec validate port-health-slice-to-rust-runtime-phase1 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
