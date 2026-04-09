## 1. Specification

- [x] 1.1 Add OpenSpec change `port-dashboard-plans-read-apis-to-rust-phase5` for dashboard/plans read API parity.
- [x] 1.2 Define header-forwarding, path/query-forwarding, and fail-closed scenarios.

## 2. Implementation

- [x] 2.1 Add Rust route handlers for `/api/dashboard/overview` and `/api/dashboard/system-monitor`.
- [x] 2.2 Add Rust route handlers for `/api/projects/plans`, `/api/projects/plans/{plan_slug}`, and `/api/projects/plans/{plan_slug}/runtime`.
- [x] 2.3 Ensure dashboard auth headers and query parameters are forwarded upstream.
- [x] 2.4 Reuse fail-closed JSON `503` behavior for dashboard/plans proxy failures.
- [x] 2.5 Add Rust unit tests for dashboard/plans proxy parity behavior.

## 3. Verification

- [x] 3.1 Run `cargo test` for `rust/codex-lb-runtime`.
- [x] 3.2 Run `cargo clippy -- -D warnings` for `rust/codex-lb-runtime`.
- [x] 3.3 Run `openspec validate port-dashboard-plans-read-apis-to-rust-phase5 --type change --strict`.
- [x] 3.4 Run `openspec validate --specs`.
