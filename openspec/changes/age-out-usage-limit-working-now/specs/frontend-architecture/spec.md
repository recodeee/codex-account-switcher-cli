## MODIFIED Requirements

### Requirement: Dashboard page

The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Usage-limit-hit accounts age out of Working now after short grace
- **WHEN** an account has rounded 5h remaining at `0%`
- **AND** the account still has active CLI session signals
- **THEN** the account SHALL remain eligible for `Working now` for at most 60 seconds
- **AND** after 60 seconds it SHALL be removed from `Working now` grouping.

#### Scenario: Usage-limit-hit countdown is visible during grace
- **WHEN** an account is in the 60-second usage-limit grace window
- **THEN** the account card SHALL show a visible countdown indicating when it leaves `Working now`.

#### Scenario: Usage-limit-hit card container is visually highlighted
- **WHEN** an account is usage-limit-hit
- **THEN** the dashboard account card container SHALL use a red-tinted background/border treatment.
