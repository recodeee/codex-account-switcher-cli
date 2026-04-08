## MODIFIED Requirements

### Requirement: Subscription seat and entitlement state is workflow-backed
Subscription seat and entitlement changes SHALL be applied through Medusa workflows rather than direct bulk replacement of Python billing rows.

#### Scenario: Subscription account is deleted through Medusa workflow boundary
- **WHEN** an authenticated dashboard operator deletes a subscription account from Billing
- **THEN** the mutation is handled by the Medusa subscription boundary
- **AND** the persisted account and its seat rows are removed from the configured database backend
- **AND** a later billing summary read no longer returns the deleted account
