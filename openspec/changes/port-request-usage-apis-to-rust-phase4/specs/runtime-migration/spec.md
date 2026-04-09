## ADDED Requirements

### Requirement: Rust request-log and usage API parity bridge
The Rust runtime SHALL provide Phase-4 parity bridge handlers for request-log and usage API families by proxying Python endpoints with query/header fidelity.

#### Scenario: Rust request-log usage summary preserves dashboard auth context
- **WHEN** `GET /api/request-logs/usage-summary` is called with dashboard session credentials
- **THEN** Rust forwards dashboard auth headers upstream
- **AND** returns the upstream status code and JSON payload.

#### Scenario: Rust usage history forwards query parameters upstream
- **WHEN** `GET /api/usage/history?hours=48` is called on the Rust runtime
- **THEN** Rust forwards `hours=48` upstream
- **AND** returns upstream JSON response content for that query.

#### Scenario: Rust request-log and usage proxies fail closed on upstream outage
- **WHEN** Python upstream is unavailable for `/api/request-logs*` or `/api/usage*`
- **THEN** Rust returns HTTP `503`
- **AND** response payload is JSON with an explicit upstream failure detail.
