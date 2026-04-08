## MODIFIED Requirement: Authenticated billing API reads Medusa-backed subscription summaries
The dashboard billing experience SHALL return authenticated subscription summaries that are read from the Medusa subscription domain and present derived monthly spend details from the live account summary.

#### Scenario: Billing dashboard shows monthly spend from live seat totals
- **WHEN** an authenticated dashboard session opens Billing and live account summaries are available
- **THEN** the dashboard shows a monthly euro spend total derived from the current billed accounts
- **AND** the total uses the current pricing rule of `€26` per ChatGPT seat and `€0` per Codex seat
- **AND** the dashboard shows the formula inputs so operators can audit the displayed total
