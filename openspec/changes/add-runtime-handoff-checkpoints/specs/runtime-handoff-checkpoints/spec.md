## ADDED Requirements

### Requirement: Runtime checkpoints preserve resumable progress durably
The system SHALL create a durable checkpoint artifact when a Codex/OMX runtime is near quota exhaustion, has exhausted quota, or an operator explicitly initiates a handoff. The artifact MUST capture enough structured progress to resume the task in a fresh session without relying on live in-memory state.

#### Scenario: Proactive low-quota checkpoint is created before interruption
- **GIVEN** a runtime has a validated account/runtime identity and detects that quota is below the configured low-remaining threshold
- **WHEN** checkpoint creation succeeds before the session stops
- **THEN** the system stores a checkpoint artifact with `goal`, `completedWork`, `nextSteps`, `blockers`, `filesTouched`, `commandsRun`, and `evidenceRefs`
- **AND** the artifact status is `ready`

#### Scenario: Quota exhaustion still produces a durable checkpoint
- **GIVEN** a runtime confirms quota exhaustion before task completion
- **WHEN** the runtime runs the checkpoint save flow
- **THEN** it writes the durable artifact before marking the session interrupted
- **AND** the saved artifact records `triggerReason = quota_exhausted`

### Requirement: Checkpoint resume is fail-closed and auditable
The system SHALL start a new session from checkpoint state only after validating artifact integrity, freshness, and runtime/account compatibility.

#### Scenario: Matching runtime/account resumes successfully
- **GIVEN** a `ready` checkpoint artifact with a valid checksum and unexpired TTL
- **AND** the target runtime/account satisfies the compatibility rules for that artifact
- **WHEN** resume is requested
- **THEN** the system starts a new session seeded from the checkpoint summary
- **AND** updates the artifact status to `resumed`
- **AND** records `lastResumedAt` and increments `resumeCount`

#### Scenario: Mismatched runtime/account is rejected by default
- **GIVEN** a `ready` checkpoint artifact
- **AND** the target runtime/account does not satisfy the compatibility rules
- **WHEN** resume is requested without an explicit override
- **THEN** the resume is rejected
- **AND** the artifact remains `ready`

#### Scenario: Expired checkpoint is blocked by default
- **GIVEN** a checkpoint artifact whose TTL has elapsed
- **WHEN** resume is requested
- **THEN** the system marks the artifact stale/expired
- **AND** blocks resume unless an explicit operator override path is defined for that artifact type

### Requirement: Dashboard visibility reflects checkpoint state without altering live-session detection
The dashboard SHALL expose checkpoint availability and lifecycle state as additive runtime metadata without changing the existing live-session/task-preview detection rules for non-checkpoint flows.

#### Scenario: Dashboard shows resumable checkpoint state
- **GIVEN** an account/runtime has a `ready` checkpoint artifact
- **WHEN** the dashboard requests account/runtime status
- **THEN** the response includes checkpoint metadata needed to render source provenance, readiness, and resume gating
- **AND** non-checkpoint working-state logic remains based on the existing live-session/task-preview rules
