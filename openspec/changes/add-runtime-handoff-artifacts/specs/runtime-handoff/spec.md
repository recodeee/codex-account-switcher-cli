## ADDED Requirements

### Requirement: Runtime handoff artifacts for cross-account continuation

The system SHALL provide a durable runtime handoff artifact that captures checkpoint context (`goal`, `done`, `next`, and evidence pointers) so interrupted work can continue on another runtime/account.

#### Scenario: Create a resumable handoff artifact

- **WHEN** an operator creates a handoff with a valid source snapshot
- **THEN** the system persists a durable artifact with `status = ready`
- **AND** the artifact includes a checksum and expiration timestamp

#### Scenario: Resume on compatible target runtime/snapshot

- **WHEN** an operator resumes a `ready` handoff using a valid target runtime and compatible target snapshot
- **THEN** the system marks the artifact as `resumed`
- **AND** returns a deterministic resume prompt containing checkpoint context

### Requirement: Fail-closed resume validation

The system SHALL reject unsafe resume attempts by default.

#### Scenario: Expected target snapshot mismatch without override

- **WHEN** a handoff defines `expected_target_snapshot`
- **AND** resume is requested with a different `target_snapshot` and no override
- **THEN** the system rejects the request with a validation error
- **AND** the handoff remains resumable (`status = ready`)

#### Scenario: Missing target snapshot

- **WHEN** the requested target snapshot does not exist locally
- **THEN** the system rejects the resume request
- **AND** no lifecycle transition occurs

### Requirement: Expiration and lifecycle visibility

The system SHALL expose lifecycle status for runtime handoff artifacts.

#### Scenario: Expired handoff normalization

- **WHEN** a `ready` handoff is read after its expiration timestamp
- **THEN** the system marks it as `expired`
- **AND** it is no longer resumable without creating a new handoff
