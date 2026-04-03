## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests section with consumed-token usage donuts, filtering, and pagination.

#### Scenario: Request Logs consumed-token usage falls back to live windows when request totals are empty
- **WHEN** `/api/request-logs/usage-summary` returns `last5h.totalTokens = 0` and/or `last7d.totalTokens = 0`
- **THEN** the frontend computes fallback consumed totals from dashboard live windows using `max(0, capacityCredits - remainingCredits)`
- **AND** the 5h donut uses `overview.windows.primary` only when `last5h.totalTokens = 0`
- **AND** the weekly donut uses `overview.windows.secondary` only when `last7d.totalTokens = 0`
- **AND** each donut still uses request-log totals whenever that window has non-zero request-log tokens
- **AND** the UI shows `Using live usage fallback because recent request logs are empty.` whenever at least one fallback window is active

#### Scenario: Request Logs usage-summary API contract stays unchanged
- **WHEN** frontend fallback behavior is enabled
- **THEN** the client still requests `/api/request-logs/usage-summary` without additional parameters
- **AND** no backend schema or response fields are required for the fallback behavior
