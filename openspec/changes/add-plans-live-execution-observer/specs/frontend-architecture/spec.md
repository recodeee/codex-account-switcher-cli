## ADDED Requirements

### Requirement: Plans detail exposes a live runtime observer

The `/projects/plans` detail view SHALL include a runtime observer companion payload and UI panel that shows session lifecycle and lane progress without replacing existing static OpenSpec summary/checkpoint content.

#### Scenario: Active plan runtime renders observer details

- **WHEN** `GET /api/projects/plans/{plan_slug}/runtime` returns a correlated active session
- **THEN** the response includes session metadata (`sessionId`, `mode`, `phase`, `active`, `updatedAt`)
- **AND** includes normalized lane roster entries (`name`, `role`, `model`, `status`)
- **AND** includes normalized timeline events suitable for dashboard rendering
- **AND** the frontend renders a "Live plan observer" card with lane/timeline sections.

### Requirement: Runtime observer fails closed on missing telemetry

The runtime observer contract SHALL fail closed when authoritative structured lane telemetry is missing or invalid.

#### Scenario: Structured agent telemetry missing

- **WHEN** a correlated session exists but `ralplan-agent-events.jsonl` is absent or unreadable
- **THEN** the runtime response returns `available = false`
- **AND** sets `partial = true`
- **AND** includes explicit reason codes and `unavailableReason`
- **AND** static plan summary/checkpoint rendering remains available.

### Requirement: Runtime observer includes deterministic resume markers

The runtime observer SHALL expose persisted resume markers for continuation safety.

#### Scenario: Resume state present after runtime/account failure

- **WHEN** `ralplan-resume-state.json` exists for the correlated session
- **THEN** runtime responses include `lastCheckpoint`, `lastError`, and `canResume`
- **AND** the frontend runtime observer displays these markers so operators can continue from a deterministic checkpoint.
