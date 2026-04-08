## MODIFIED Requirement: Billing page renders live subscription dashboard state
The Billing page SHALL render live subscription dashboard data from the authenticated billing API instead of embedded business-plan constants.

#### Scenario: Billing page shows live subscription summary
- **WHEN** the frontend loads `/billing`
- **AND** `GET /api/billing` returns subscription account data
- **THEN** the page renders account-level plan status, renewal timing, payment state, seat counts, and member drill-down actions for each billed account

#### Scenario: Billing page supports editing subscription account settings
- **WHEN** an operator selects `Edit` for a billed account from the Billing subscription table
- **THEN** the page opens an account-management dialog with the current plan, entitlement, renewal, and seat-count fields prefilled
- **AND** saving valid changes updates the live subscription table without leaving `/billing`
