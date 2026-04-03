## MODIFIED Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests section with consumed-token usage donuts, filtering, and pagination.

#### Scenario: Request Logs consumed-token usage summary is visible
- **WHEN** the Dashboard page loads Request Logs data
- **THEN** the UI renders a consumed-token usage panel under Request Logs with `5h` and `Weekly` donut charts
- **AND** each chart shows both a total consumed token count and per-account token legend values

#### Scenario: Request Logs usage summary uses rolling global windows
- **WHEN** Request Logs consumed-token usage is queried
- **THEN** the frontend requests `/api/request-logs/usage-summary`
- **AND** the backend aggregates tokens for rolling windows of `now-5h..now` and `now-7d..now`
- **AND** those aggregates are independent from request-log table filters

#### Scenario: Usage summary includes unassigned traffic
- **WHEN** request logs contain rows without an `account_id`
- **THEN** `/api/request-logs/usage-summary` includes those tokens in window totals
- **AND** the frontend renders them as a dedicated legend entry
