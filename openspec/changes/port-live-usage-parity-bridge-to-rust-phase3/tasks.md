## 1. Specification

- [x] 1.1 Add OpenSpec change `port-live-usage-parity-bridge-to-rust-phase3` for live-usage parity bridging.
- [x] 1.2 Define parity and fallback scenarios for `/live_usage` and `/live_usage/mapping`.

## 2. Implementation

- [x] 2.1 Proxy Rust `GET /live_usage` to Python live-usage XML endpoint.
- [x] 2.2 Proxy Rust `GET /live_usage/mapping` to Python mapping XML endpoint with query forwarding.
- [x] 2.3 Keep no-store XML fallback payloads when upstream probing fails.
- [x] 2.4 Add Rust unit tests for passthrough parity and mapping query forwarding.
- [x] 2.5 Extend `scripts/rust_runtime/compare_runtime.py` to support XML canonical parity checks.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo clippy -- -D warnings` for `rust/codex-lb-runtime`.
- [x] 3.3 Run `python scripts/rust_runtime/compare_runtime.py --help`.
- [x] 3.4 Run `openspec validate port-live-usage-parity-bridge-to-rust-phase3 --type change --strict`.
- [x] 3.5 Run `openspec validate --specs`.
