## ADDED Requirements

### Requirement: Rust wildcard API cutover bridge
The Rust runtime SHALL expose wildcard API proxy routes so frontend traffic can traverse Rust while Python remains the business-logic backend.

#### Scenario: `/api/*` wildcard forwards authenticated dashboard request
- **WHEN** `GET /api/dashboard-auth/session` is called through Rust with a valid dashboard cookie
- **THEN** Rust forwards method/path/query/auth headers to Python
- **AND** returns upstream status and JSON payload.

#### Scenario: `/backend-api/*` wildcard forwards query parameters
- **WHEN** `GET /backend-api/ping?scope=ops` is called through Rust
- **THEN** Rust forwards the query parameters upstream
- **AND** returns the upstream JSON payload.

#### Scenario: `/v1/*` wildcard forwards POST body and preserves set-cookie
- **WHEN** `POST /v1/echo` is called through Rust with JSON body and content-type header
- **THEN** Rust forwards method/body/content-type upstream
- **AND** forwards upstream `Set-Cookie` response headers.

#### Scenario: Wildcard bridge fails closed on upstream outage
- **WHEN** Python upstream is unavailable for wildcard-proxied routes
- **THEN** Rust returns HTTP `503`
- **AND** response payload includes explicit upstream failure detail.
