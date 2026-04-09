## ADDED Requirements

### Requirement: Rust accounts and auth API parity bridge
The Rust runtime SHALL proxy account and auth API families to Python while preserving contract-relevant headers and fallback safety.

#### Scenario: Rust account trends endpoint forwards path and dashboard auth context
- **WHEN** `GET /api/accounts/{account_id}/trends` is called with dashboard session credentials
- **THEN** Rust forwards the request path and auth headers upstream
- **AND** returns upstream JSON payload/status.

#### Scenario: Rust dashboard auth login forwards body and preserves session cookie
- **WHEN** `POST /api/dashboard-auth/password/login` is called through Rust
- **THEN** Rust forwards request body and content-type upstream
- **AND** Rust forwards upstream `Set-Cookie` headers in the response.

#### Scenario: Rust medusa auth status forwards query parameters
- **WHEN** `GET /api/medusa-admin-auth/status?email=...` is called through Rust
- **THEN** Rust forwards query parameters upstream
- **AND** returns upstream JSON payload/status.

#### Scenario: Rust account/auth proxies fail closed on upstream outage
- **WHEN** Python upstream is unavailable for `/api/accounts/*`, `/api/dashboard-auth/*`, or `/api/medusa-admin-auth/*`
- **THEN** Rust returns HTTP `503`
- **AND** response payload includes explicit upstream failure detail.
