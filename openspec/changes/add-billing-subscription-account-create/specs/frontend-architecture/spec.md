## ADDED Requirements

### Requirement: Billing page supports creating subscription accounts
The Billing page SHALL provide an authenticated create-account flow so operators can add a subscription account directly from `/billing`.

#### Scenario: Operator creates a new subscription account from Billing
- **WHEN** the operator submits valid account details in the Billing create-account dialog
- **THEN** the frontend calls the authenticated billing create endpoint
- **AND** the live subscription account table refreshes with the new account entry

#### Scenario: Invalid subscription account creation shows validation feedback
- **WHEN** the create request fails validation (for example, duplicate domain)
- **THEN** the Billing page shows a non-destructive error message
- **AND** existing subscription rows remain unchanged
