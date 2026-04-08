## ADDED Requirements

### Requirement: Billing page supports deleting subscription accounts
The Billing page SHALL provide a delete-account flow so operators can remove a subscription account directly from `/billing`.

#### Scenario: Operator deletes a subscription account from Billing
- **WHEN** the operator confirms deletion for a subscription account
- **THEN** the frontend calls the authenticated billing delete endpoint
- **AND** the live subscription account table refreshes without the deleted row

#### Scenario: Add-account access remains available after deleting all rows
- **WHEN** the Billing summary has no remaining subscription accounts
- **THEN** the page still presents an add-account action
- **AND** the operator can create a replacement account without leaving `/billing`
