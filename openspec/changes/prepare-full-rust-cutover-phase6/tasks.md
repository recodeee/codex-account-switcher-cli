## 1. Specification

- [x] 1.1 Add OpenSpec change `prepare-full-rust-cutover-phase6` for wildcard Rust cutover bridge.
- [x] 1.2 Define forwarding and fail-closed scenarios for wildcard routes.

## 2. Implementation

- [x] 2.1 Add wildcard routes for `/api/{*path}`, `/backend-api/{*path}`, and `/v1/{*path}`.
- [x] 2.2 Forward method + path + query + auth headers + `content-type` through Rust wildcard bridge.
- [x] 2.3 Forward upstream `Set-Cookie` headers through Rust responses.
- [x] 2.4 Remove now-unused per-endpoint account/auth helper code superseded by wildcard routing.
- [x] 2.5 Extend Rust tests for wildcard forwarding behavior and fail-closed handling.

## 3. Verification

- [x] 3.1 Run `cargo fmt` in `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo test` in `rust/codex-lb-runtime`.
- [x] 3.3 Run `cargo clippy -- -D warnings` in `rust/codex-lb-runtime`.
- [x] 3.4 Run `openspec validate prepare-full-rust-cutover-phase6 --type change --strict`.
- [x] 3.5 Run `openspec validate --specs`.
