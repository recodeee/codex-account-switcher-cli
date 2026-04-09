## 1. Specification

- [x] 1.1 Add OpenSpec change `start-rust-runtime-layer-phase0` with phase-0 migration requirements.
- [x] 1.2 Define acceptance scenarios for health parity and runtime comparison tooling output.

## 2. Implementation

- [x] 2.1 Scaffold `rust/codex-lb-runtime` with `/health`, `/health/live`, and `/_rust_layer/info` endpoints.
- [x] 2.2 Add a benchmark/parity utility under `scripts/rust_runtime/compare_runtime.py`.
- [x] 2.3 Add usage notes under `scripts/rust_runtime/README.md`.
- [x] 2.4 Add `GET /` runtime health panel for quick browser verification.
- [x] 2.5 Expand Rust health slice with `GET /health/ready` and `GET /health/startup`.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `python scripts/rust_runtime/compare_runtime.py --help`.
- [x] 3.3 Run `openspec validate start-rust-runtime-layer-phase0 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
