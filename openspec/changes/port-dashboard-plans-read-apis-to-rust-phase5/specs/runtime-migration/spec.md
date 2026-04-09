## ADDED Requirements

### Requirement: Rust dashboard and plans read API parity bridge
The Rust runtime SHALL provide a Phase-5 parity bridge for read-only dashboard and plans APIs by proxying Python endpoints with dashboard-auth header, path, and query fidelity.

#### Scenario: Rust dashboard overview preserves dashboard auth context
- **WHEN** `GET /api/dashboard/overview` is called with dashboard session credentials
- **THEN** Rust forwards dashboard auth headers upstream
- **AND** returns the upstream status code and JSON payload.

#### Scenario: Rust plan runtime endpoint preserves slug path and query context
- **WHEN** `GET /api/projects/plans/{plan_slug}/runtime?project_id=...` is called on Rust
- **THEN** Rust forwards the same `plan_slug` path segment and query parameters upstream
- **AND** returns upstream JSON response content for that path/query combination.

#### Scenario: Rust dashboard and plans proxies fail closed on upstream outage
- **WHEN** Python upstream is unavailable for `/api/dashboard/*` or `/api/projects/plans*`
- **THEN** Rust returns HTTP `503`
- **AND** response payload is JSON with an explicit upstream failure detail.
