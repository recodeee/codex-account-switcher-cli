## 1. Specification

- [x] 1.1 Add OpenSpec change `port-runtime-schedulers-to-rust-phase7a` for Rust-owned scheduler lifecycle parity.
- [x] 1.2 Define start/stop/shutdown lifecycle requirements and scenarios.

## 2. Implementation

- [x] 2.1 Add scheduler lifecycle module(s) in `rust/codex-lb-runtime/src/runtime/**`.
- [x] 2.2 Expose scheduler module via `runtime/mod.rs` for later integration.
- [x] 2.3 Implement lifecycle semantics: enabled gating, idempotent start, cancel-on-stop, reverse-order shutdown.
- [x] 2.4 Add integrator handoff note for `main.rs` wiring (no direct `main.rs` edits).

## 3. Verification

- [x] 3.1 Run `bun run verify:rust-runtime-guardrails`.
- [x] 3.2 Run `cargo check --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [x] 3.3 Run `cargo test --manifest-path rust/Cargo.toml -p codex-lb-runtime --no-run`.
- [x] 3.4 Run `cargo test --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [x] 3.5 Run `cargo clippy --manifest-path rust/Cargo.toml -p codex-lb-runtime -- -D warnings`.
- [x] 3.6 Run `openspec validate port-runtime-schedulers-to-rust-phase7a --type change --strict`.
- [x] 3.7 Run `openspec validate --specs`.
