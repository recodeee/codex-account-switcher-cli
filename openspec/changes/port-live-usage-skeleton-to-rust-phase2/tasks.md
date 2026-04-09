## 1. Specification

- [x] 1.1 Add OpenSpec change `port-live-usage-skeleton-to-rust-phase2` for Rust live usage baseline endpoints.
- [x] 1.2 Define acceptance scenarios for XML response shape and no-store cache headers.

## 2. Implementation

- [x] 2.1 Add `GET /live_usage` endpoint in Rust with XML baseline payload.
- [x] 2.2 Add `GET /live_usage/mapping` endpoint in Rust with XML baseline payload.
- [x] 2.3 Ensure both endpoints return `Cache-Control: no-store`.
- [x] 2.4 Add Rust unit tests for XML root tags and headers.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo clippy -- -D warnings` for `rust/codex-lb-runtime`.
- [x] 3.3 Run `openspec validate port-live-usage-skeleton-to-rust-phase2 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
