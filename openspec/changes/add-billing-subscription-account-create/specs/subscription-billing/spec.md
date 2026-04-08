## MODIFIED Requirements

### Requirement: Subscription seat and entitlement state is workflow-backed
Subscription seat and entitlement changes SHALL be applied through Medusa workflows rather than direct bulk replacement of Python billing rows.

#### Scenario: New subscription account is created through Medusa workflow boundary
- **WHEN** an authenticated dashboard operator creates a new subscription account from Billing
- **THEN** the mutation is handled by the Medusa subscription boundary
- **AND** the created account is returned in the normalized billing summary shape
- **AND** duplicate domains are rejected with an explicit validation error
