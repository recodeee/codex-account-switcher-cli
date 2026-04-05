## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Account-card CLI debug output distinguishes mapped sessions from quota rows
- **WHEN** an account card has mapped live CLI sessions but no quota-bearing `liveQuotaDebug.rawSamples`
- **THEN** the expanded CLI session debug panel reports the mapped live session count separately from quota sample rows
- **AND** the panel explains that quota-bearing CLI samples are unavailable instead of implying the sessions were not mapped
- **AND** the panel reflects the waiting-for-task fallback when no current task preview is available for those mapped sessions
