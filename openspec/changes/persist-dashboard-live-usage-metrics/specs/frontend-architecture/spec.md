## ADDED Requirements

### Requirement: Dashboard live usage overrides are persisted per account
When dashboard/accounts responses apply local Codex live-usage overrides, the backend SHALL persist those per-account window values into usage history so subsequent responses remain consistent.

#### Scenario: Persist newer changed live override window values
- **WHEN** local live telemetry resolves a primary or secondary window for an account
- **AND** the telemetry timestamp is newer than the latest stored usage row for that account/window
- **AND** used-percent/reset/window-minutes differ from the latest stored row
- **THEN** the backend persists a new `usage_history` row for that account/window using the telemetry timestamp

#### Scenario: Skip unchanged or stale live override persistence writes
- **WHEN** local live telemetry resolves a window value that matches the latest stored row
- **OR** the latest stored row is newer than the telemetry timestamp
- **THEN** the backend does not append a new `usage_history` row for that account/window

### Requirement: Dashboard account card metrics prioritize active-now semantics
Dashboard account cards SHALL avoid stale/unknown derivation paths when rendering token totals and Codex session counts.

#### Scenario: Token totals ignore unknown usage rows
- **WHEN** a dashboard usage window row has `remainingPercentAvg = null`
- **THEN** that row is ignored for card token-consumed derivation
- **AND** the card falls back to request-usage totals when no known consumed value exists

#### Scenario: Card sessions show active-now telemetry only
- **WHEN** a dashboard account card renders `Codex CLI sessions`
- **THEN** the displayed value is `0` when `codexAuth.hasLiveSession` is false
- **AND** the displayed value is at least `1` when `codexAuth.hasLiveSession` is true
- **AND** sessions-page aggregation semantics remain unchanged
