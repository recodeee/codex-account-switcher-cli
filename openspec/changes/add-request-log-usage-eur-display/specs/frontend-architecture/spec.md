## MODIFIED Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests section with consumed-token usage donuts, filtering, and pagination.

#### Scenario: Request Logs usage-summary includes cost and FX metadata
- **WHEN** the frontend requests `/api/request-logs/usage-summary`
- **THEN** the backend response includes rolling `last5h` and `last7d` totals for both `totalTokens` and cost values (`totalCostUsd`, `totalCostEur`)
- **AND** each account row includes `tokens`, `costUsd`, and `costEur`
- **AND** the response includes a deterministic `fxRateUsdToEur` value.

#### Scenario: Request Logs section shows EUR values with token usage
- **WHEN** usage-summary data is rendered under Request Logs
- **THEN** cards and donut sections show token totals and EUR values for both 5h and 7d windows
- **AND** EUR display uses the `fxRateUsdToEur` provided by the usage-summary payload.

#### Scenario: Fallback windows do not show synthetic EUR values
- **WHEN** a request-log usage window falls back to live usage because request-log totals are empty
- **THEN** the UI still shows token usage for that fallback window
- **AND** EUR values for that fallback window are shown as unavailable (`N/A`) instead of inferred estimates.
