## 1. Specification

- [x] 1.1 Add OpenSpec change `port-proxy-streaming-hotpath-to-rust-phase6` for wildcard streaming parity.
- [x] 1.2 Define wildcard forwarding, header passthrough, and fail-closed behavior expectations.

## 2. Implementation

- [x] 2.1 Update Rust wildcard proxies (`/api/{*path}`, `/backend-api/{*path}`, `/v1/{*path}`) to stream upstream response bodies.
- [x] 2.2 Preserve upstream `content-type`, `cache-control`, and `set-cookie` headers during streamed responses.
- [x] 2.3 Keep request method/query/body/auth header forwarding behavior unchanged.
- [x] 2.4 Add Rust tests covering wildcard stream content-type/body passthrough.

## 3. Verification

- [x] 3.1 Run `cargo test -p codex-lb-runtime` from `rust/`.
- [x] 3.2 Run `cargo clippy -p codex-lb-runtime -- -D warnings` from `rust/`.
- [x] 3.3 Run `openspec validate port-proxy-streaming-hotpath-to-rust-phase6 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
