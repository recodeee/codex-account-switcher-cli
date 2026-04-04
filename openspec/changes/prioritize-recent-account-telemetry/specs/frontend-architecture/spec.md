## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Other accounts prioritize recent telemetry before stale telemetry
- **WHEN** dashboard account cards are rendered outside the `Working now` group
- **AND** some accounts have their most recent usage timestamp within 30 minutes
- **AND** other accounts have no usage timestamp or only timestamps older than 30 minutes
- **THEN** recent-telemetry accounts SHALL render before stale/unknown accounts
- **AND** quota-based ordering (5h remaining, then weekly tie-breakers) SHALL still apply within each telemetry-recency bucket.
