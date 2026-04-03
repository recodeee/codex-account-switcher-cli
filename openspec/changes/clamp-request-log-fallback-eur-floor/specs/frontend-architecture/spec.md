## MODIFIED Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Fallback windows use a minimum density floor for EUR estimates
- **WHEN** a request-log usage window is replaced by live fallback because request-log totals are empty
- **THEN** fallback EUR values are estimated from prioritized request-log density sources
- **AND** the effective fallback density is clamped to a minimum baseline of **3 USD per 1,000,000 tokens**
- **AND** non-fallback request-log windows keep their original EUR values without floor adjustment.

#### Scenario: Fallback hint messaging states guardrail context
- **WHEN** Request Logs cards/donuts display fallback EUR values
- **THEN** the fallback hint copy indicates values are estimated from live fallback tokens with a minimum-rate guardrail.
