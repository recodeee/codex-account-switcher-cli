## MODIFIED Requirements

### Requirement: Dashboard page

The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Usage-limit-hit accounts stay in Working now while CLI sessions are still active
- **WHEN** an account is usage-limit-hit (`0%` rounded 5h remaining)
- **AND** its 60-second grace window has expired
- **AND** strong CLI session evidence remains (live/tracked session counters, meaningful session task preview, or fresh live telemetry)
- **THEN** the account SHALL remain in `Working now`.

#### Scenario: Expired grace hides stale current task only after CLI work has settled
- **WHEN** an account card is usage-limit-hit and its 60-second grace has expired
- **AND** strong CLI session evidence is no longer present
- **THEN** the card SHALL hide stale prior `Current task` text.

#### Scenario: Terminal session previews are treated as settled after grace
- **WHEN** an account is usage-limit-hit and its 60-second grace has expired
- **AND** session task previews report terminal outcomes (`failed`, `errored`, or `stopped`)
- **THEN** those previews SHALL NOT keep the account in `Working now`.
