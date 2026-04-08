## MODIFIED Requirements

### Requirement: Dashboard page

The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Usage-limit grace expiry does not terminate CLI sessions
- **WHEN** an account is usage-limit-hit and its 60-second grace window expires
- **THEN** the account card SHALL stop showing the grace countdown overlay
- **AND** the dashboard SHALL NOT auto-dispatch `terminateCliSessions` for that account.
