## MODIFIED Requirements

### Requirement: Console runtime logs include explicit timestamps
The system SHALL emit server console logs with an explicit timestamp on each line for both application logs and HTTP access logs.

### Requirement: Live usage XML observability feed
The system SHALL expose XML health feeds for codex CLI runtime session visibility.

#### Scenario: Raw per-snapshot session feed remains available
- **WHEN** an operator calls `GET /live_usage`
- **THEN** the response SHALL be XML with per-snapshot CLI process session counts
- **AND** the response SHALL include `Cache-Control: no-store`.

#### Scenario: Mapping feed exposes account-to-snapshot CLI attribution
- **WHEN** an operator calls `GET /live_usage/mapping`
- **THEN** the response SHALL be XML with:
  - account rows including mapped snapshot and CLI signal attributes,
  - active snapshot metadata,
  - unmapped CLI snapshot rows
- **AND** the response SHALL include `Cache-Control: no-store`.

#### Scenario: Mapping feed supports compact mode
- **WHEN** an operator calls `GET /live_usage/mapping?minimal=true`
- **THEN** the response SHALL remain XML and include compact account rows with mapping + working-signal fields
- **AND** the response SHALL still include unmapped CLI snapshot rows.
