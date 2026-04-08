## MODIFIED Requirement: Medusa owns subscription dashboard source-of-truth records
The system SHALL persist billed-account records in the Medusa subscription module's database tables so account edits and seat totals survive backend restarts.

#### Scenario: Billing edits persist across backend restarts
- **WHEN** an operator updates a billed account's plan state or seat totals from Billing
- **THEN** the Medusa subscription module stores the updated account and seat rows in its configured database backend
- **AND** a later billing summary read returns the saved values instead of process-memory defaults

#### Scenario: Empty subscription storage is initialized from the current billing fixture
- **WHEN** the Medusa subscription billing tables are empty and Billing summary is requested
- **THEN** the module seeds the current fixture-backed billing accounts into subscription storage once
- **AND** subsequent billing reads use the persisted rows as the source of truth
