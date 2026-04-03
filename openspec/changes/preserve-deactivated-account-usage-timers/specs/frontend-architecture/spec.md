## ADDED Requirements

### Requirement: Deactivated account cards keep last-known quota timing context
Dashboard/account UI SHALL preserve last-known 5h/weekly usage timing context for deactivated accounts by exposing and rendering usage sample timestamps.

#### Scenario: Backend includes last usage timestamps in account summary
- **WHEN** dashboard or accounts APIs return an account summary
- **THEN** payload includes `lastUsageRecordedAtPrimary` and `lastUsageRecordedAtSecondary` (nullable ISO timestamps)

#### Scenario: Deactivated account card shows last-seen context
- **WHEN** an account has `status = deactivated`
- **AND** `lastUsageRecordedAtPrimary` or `lastUsageRecordedAtSecondary` is present
- **THEN** the account-card status row renders a `last seen <relative>` badge next to the deactivated status badge
- **AND** the card uses the primary timestamp when available, otherwise secondary
- **AND** the 5h quota progress bar uses a neutral gray style instead of healthy/warning/critical colors

#### Scenario: Non-deactivated account does not show last-seen labels
- **WHEN** an account status is not `deactivated`
- **THEN** the status row does not render a `last seen` badge

### Requirement: Deactivated dashboard cards are grouped after active cards
Dashboard account-card ordering SHALL keep deactivated cards visually separated by rendering them after non-deactivated cards.

#### Scenario: Mixed account statuses are sorted in dashboard cards
- **WHEN** the dashboard renders account cards for mixed active and deactivated statuses
- **THEN** non-deactivated accounts appear first in their existing relative order
- **AND** deactivated accounts appear after them in their existing relative order
