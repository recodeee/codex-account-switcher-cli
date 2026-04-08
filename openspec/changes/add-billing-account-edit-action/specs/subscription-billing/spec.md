## MODIFIED Requirement: Subscription seat and entitlement state is workflow-backed
Subscription seat and entitlement changes SHALL be applied through the Medusa subscription boundary rather than direct bulk replacement of Python billing rows.

#### Scenario: Billing account settings are updated from the dashboard
- **WHEN** an authenticated dashboard operator saves edits for an existing billed account from Billing
- **THEN** the authenticated billing facade forwards the change to the Medusa subscription boundary
- **AND** the updated account summary is returned in the normalized billing response shape

#### Scenario: Invalid billing updates are rejected without mutating account state
- **WHEN** the dashboard submits an invalid billing account update payload
- **THEN** the billing update path returns a validation error
- **AND** previously stored billing accounts remain unchanged
