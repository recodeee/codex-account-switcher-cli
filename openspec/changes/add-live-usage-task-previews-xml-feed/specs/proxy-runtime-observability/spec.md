## MODIFIED Requirements

### Requirement: Live usage XML observability feed
The system SHALL expose XML health feeds for codex CLI runtime session visibility.

#### Scenario: Raw per-snapshot session feed includes task preview mapping metadata
- **WHEN** an operator calls `GET /live_usage`
- **THEN** the response SHALL be XML with per-snapshot CLI process session counts
- **AND** the root `<live_usage>` node SHALL include `total_task_previews`
- **AND** the root `<live_usage>` node SHALL include `mapped_sessions` and `unattributed_sessions`
- **AND** each snapshot with mapped active task previews SHALL include `task_preview_count` and nested `<task_preview ... />` rows
- **AND** when active CLI sessions cannot be snapshot-attributed, the response SHALL include an `<unattributed_sessions>` block with one `<session pid="..."/>` row per unattributed process
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
