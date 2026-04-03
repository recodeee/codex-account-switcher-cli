## ADDED Requirements

### Requirement: Deactivated account cards keep last-known quota timing context
Dashboard/account UI SHALL preserve last-known 5h/weekly usage timing context for deactivated accounts by exposing and rendering usage sample timestamps.

#### Scenario: Backend includes last usage timestamps in account summary
- **WHEN** dashboard or accounts APIs return an account summary
- **THEN** payload includes `lastUsageRecordedAtPrimary` and `lastUsageRecordedAtSecondary` (nullable ISO timestamps)

#### Scenario: Deactivated account card shows last-seen context
- **WHEN** an account has `status = deactivated`
- **AND** `lastUsageRecordedAtPrimary` or `lastUsageRecordedAtSecondary` is present
- **THEN** corresponding quota rows render `last seen <relative>` labels alongside existing reset/timer information

#### Scenario: Non-deactivated account does not show last-seen labels
- **WHEN** an account status is not `deactivated`
- **THEN** quota rows do not render `last seen` labels
