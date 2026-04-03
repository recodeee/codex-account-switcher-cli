## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Working now indicator requires active session activity
- **WHEN** a dashboard account has `codexAuth.hasLiveSession = true`
- **OR** `codexSessionCount > 0`
- **THEN** the account card can render the `Working now` indicator

#### Scenario: Active snapshot alone does not mark an account as working now
- **WHEN** a dashboard account has `codexAuth.isActiveSnapshot = true`
- **AND** `codexAuth.hasLiveSession = false`
- **AND** `codexSessionCount = 0`
- **THEN** the account card MUST NOT render the `Working now` indicator

### Requirement: Dashboard page auto-refresh
Dashboard/account polling SHALL switch to fast refresh only while at least one account is actively working.

#### Scenario: Fast polling requires live telemetry or active session count
- **WHEN** no account has `codexAuth.hasLiveSession = true`
- **AND** no account has `codexSessionCount > 0`
- **THEN** frontend polling remains on the default interval

### Requirement: Account card codex session counters
Codex session counters in account payloads SHALL represent active codex sessions only.

#### Scenario: Stale codex sticky sessions are excluded from account counters
- **WHEN** codex-session sticky mappings are older than the active-session recency window
- **THEN** they are not counted in `accounts[].codexSessionCount`
