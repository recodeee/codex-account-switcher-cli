## ADDED Requirements

### Requirement: Rust live usage baseline endpoints
The Rust runtime SHALL expose baseline live-usage XML endpoints for iterative migration.

#### Scenario: Live usage endpoint returns XML baseline payload
- **WHEN** `GET /live_usage` is called on the Rust runtime
- **THEN** the response returns HTTP 200
- **AND** the `Content-Type` is `application/xml`
- **AND** the XML root tag is `<live_usage ...>`
- **AND** the response includes `Cache-Control: no-store`.

#### Scenario: Live usage mapping endpoint returns XML baseline payload
- **WHEN** `GET /live_usage/mapping` is called on the Rust runtime
- **THEN** the response returns HTTP 200
- **AND** the `Content-Type` is `application/xml`
- **AND** the XML root tag is `<live_usage_mapping ...>`
- **AND** the response includes `Cache-Control: no-store`.
