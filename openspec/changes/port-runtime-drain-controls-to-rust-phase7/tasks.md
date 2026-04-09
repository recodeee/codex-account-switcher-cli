## 1. Specification

- [x] 1.1 Add OpenSpec change `port-runtime-drain-controls-to-rust-phase7` for graceful drain runtime internals.
- [x] 1.2 Define drain lifecycle, bridge admission, and readiness scenarios.

## 2. Implementation

- [x] 2.1 Add Rust runtime lifecycle state for draining/bridge-drain/in-flight counters.
- [x] 2.2 Add in-flight HTTP tracking middleware (excluding websocket upgrades).
- [x] 2.3 Apply shutdown drain wait loop with configurable timeout.
- [x] 2.4 Gate responses bridge HTTP/WS entrypoints with fail-closed drain responses.
- [x] 2.5 Add/adjust Rust tests for draining readiness and bridge-drain admission behavior.

## 3. Verification

- [x] 3.1 Run `bun run verify:rust-runtime-guardrails`.
- [x] 3.2 Run `cargo check --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [x] 3.3 Run `cargo test --manifest-path rust/Cargo.toml -p codex-lb-runtime --no-run`.
- [x] 3.4 Run `cargo test --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [x] 3.5 Run `cargo clippy --manifest-path rust/Cargo.toml -p codex-lb-runtime -- -D warnings`.
- [x] 3.6 Run `openspec validate port-runtime-drain-controls-to-rust-phase7 --type change --strict`.
- [x] 3.7 Run `openspec validate --specs`.
