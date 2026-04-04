## MODIFIED Requirements

### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Tracked sessions mark accounts as working now
- **WHEN** a dashboard account has `codexTrackedSessionCount > 0`
- **AND** `codexLiveSessionCount = 0`
- **THEN** the account SHALL render the `Working now` indicator
- **AND** the account SHALL be grouped in the `Working now` section above other accounts
- **AND** live-only telemetry affordances (for example `live sessions` summary chip or live token status) SHALL remain hidden until fresh live telemetry exists.

#### Scenario: Compatibility codexSessionCount still marks working accounts
- **WHEN** a dashboard account payload includes `codexSessionCount > 0`
- **AND** `codexLiveSessionCount = 0`
- **THEN** the account SHALL still be treated as `Working now`.

#### Scenario: Merged debug quotas override stale floor artifacts
- **WHEN** account payload includes `liveQuotaDebug.merged` percentages
- **AND** persisted usage percentages are stale or floor-clamped to lower artifacts (for example `0%`)
- **THEN** dashboard card quota bars SHALL prefer merged percentages for display
- **AND** merged display values SHALL bypass cycle-floor clamping for that render.

#### Scenario: Raw debug samples mark account as working now
- **WHEN** account payload includes non-stale `liveQuotaDebug.rawSamples`
- **AND** live/tracked counters are currently zero
- **THEN** the account SHALL still be treated as `Working now`
- **AND** the account SHALL be grouped in the top working section.

#### Scenario: Raw sample count fills codex session headline when counters are zero
- **WHEN** dashboard card has fresh `liveQuotaDebug.rawSamples`
- **AND** `codexLiveSessionCount = 0` and `codexTrackedSessionCount = 0`
- **THEN** card `Codex CLI sessions` headline SHALL use fresh sample count.

### Requirement: Accounts page usage mirrors merged quota percentages
Accounts page usage bars SHALL use merged debug percentages when available.

#### Scenario: Accounts page sidebar/detail use merged weekly value
- **WHEN** account payload includes `liveQuotaDebug.merged.secondary.remainingPercent`
- **AND** persisted `usage.secondaryRemainingPercent` is stale or `0%`
- **THEN** Accounts page detail panel and sidebar row SHALL render the merged weekly percentage.

#### Scenario: Mixed default-session telemetry uses conservative floor for disconnected accounts
- **WHEN** backend detects `deferred_active_snapshot_mixed_default_sessions` for a disconnected account
- **AND** multiple raw samples disagree on remaining percentages within the active cycle
- **THEN** merged quota windows SHALL use the conservative floor (lowest remaining / highest used)
- **AND** backend SHALL persist those provisional windows so subsequent refreshes do not revert to stale DB floors.

### Requirement: Dashboard page auto-refresh
Dashboard/account polling SHALL switch to fast refresh only while at least one account is actively working.

#### Scenario: Tracked sessions keep fast polling enabled
- **WHEN** no account has fresh live telemetry
- **AND** at least one account has `codexTrackedSessionCount > 0`
- **THEN** frontend polling SHALL stay on the fast interval.
