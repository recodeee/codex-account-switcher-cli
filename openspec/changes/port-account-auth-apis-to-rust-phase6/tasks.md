## 1. Specification

- [x] 1.1 Add OpenSpec change `port-account-auth-apis-to-rust-phase5` for accounts/auth parity bridge work.
- [x] 1.2 Define auth-header/cookie forwarding and fail-closed scenarios.

## 2. Implementation

- [x] 2.1 Add Rust `/api/accounts/*` parity bridge handlers.
- [x] 2.2 Add Rust `/api/dashboard-auth/*` parity bridge handlers.
- [x] 2.3 Add Rust `/api/medusa-admin-auth/*` parity bridge handlers.
- [x] 2.4 Forward `Set-Cookie` from upstream auth responses.
- [x] 2.5 Extend Rust tests for accounts/auth query/path/body forwarding and fail-closed behavior.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo clippy -- -D warnings` for `rust/codex-lb-runtime`.
- [x] 3.3 Run `openspec validate port-account-auth-apis-to-rust-phase5 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
