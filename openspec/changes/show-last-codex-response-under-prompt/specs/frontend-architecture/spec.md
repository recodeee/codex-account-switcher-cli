## MODIFIED Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Prompt and previous codex response are shown as separate lines
- **WHEN** an account card has a current task preview and a previous task preview that is distinct and non-waiting
- **THEN** the current line is labeled as `Prompt task`
- **AND** a second line is shown and labeled as `Last codex response` with the previous preview text.
