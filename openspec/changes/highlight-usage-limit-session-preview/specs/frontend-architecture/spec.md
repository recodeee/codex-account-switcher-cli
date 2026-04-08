## MODIFIED Requirements

### Requirement: Dashboard page

The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Usage-limit task previews are visually highlighted in session rows
- **WHEN** a CLI session task preview text contains usage-limit wording (for example `You've hit your usage limit`)
- **THEN** the session preview text SHALL render in a red-emphasis style to indicate limit-hit severity.
