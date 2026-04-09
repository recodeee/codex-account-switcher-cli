## 1. Specification

- [x] 1.1 Add OpenSpec change `port-request-usage-apis-to-rust-phase4` for request-log + usage API parity.
- [x] 1.2 Define parity, header-forwarding, and fail-closed scenarios.

## 2. Implementation

- [x] 2.1 Add Rust route handlers for `/api/request-logs*` endpoint family.
- [x] 2.2 Add Rust route handlers for `/api/usage*` endpoint family.
- [x] 2.3 Forward query parameters and dashboard auth headers upstream.
- [x] 2.4 Add fail-closed JSON 503 fallback behavior when upstream requests fail.
- [x] 2.5 Add Rust unit tests for request-log + usage proxy parity behavior.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo clippy -- -D warnings` for `rust/codex-lb-runtime`.
- [x] 3.3 Run `openspec validate port-request-usage-apis-to-rust-phase4 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
