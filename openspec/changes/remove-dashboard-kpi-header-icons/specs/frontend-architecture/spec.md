### MODIFIED Requirement: Dashboard page

The Dashboard page SHALL display summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Dashboard summary card header is text-first
- **WHEN** the Dashboard metric cards are rendered
- **THEN** each card header displays the metric label without a decorative top-right icon badge
- **AND** metric value, optional meta text, and bottom trend sparkline remain visible
