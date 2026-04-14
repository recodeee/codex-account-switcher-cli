## 1. Specification

- [x] 1.1 Create OpenSpec change `rust-daemon-native-ownership-phase8`.
- [x] 1.2 Define daemon/runtime lifecycle requirements and scenarios in `specs/runtime-migration/spec.md`.
- [x] 1.3 Record rollback/fallback expectations for phase-8 scope.

## 2. Implementation

- [x] 2.1 Add Rust daemon contract/state-machine module under `rust/codex-lb-runtime/src/runtime/`.
- [x] 2.2 Add unit tests for lifecycle transitions, explicit progress semantics, cancel transitions, and stale heartbeat behavior.
- [ ] 2.3 Wire daemon contract module into runtime endpoint handlers (follow-up phase).

## 3. Verification

- [ ] 3.1 Run `cargo check --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [ ] 3.2 Run `cargo test --manifest-path rust/Cargo.toml -p codex-lb-runtime`.
- [ ] 3.3 Run `openspec validate rust-daemon-native-ownership-phase8 --type change --strict`.
- [ ] 3.4 Run `openspec validate --specs`.
