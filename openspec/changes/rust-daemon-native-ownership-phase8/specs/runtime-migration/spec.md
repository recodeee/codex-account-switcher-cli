## ADDED Requirements

### Requirement: Rust runtime defines daemon lifecycle contracts
The Rust runtime SHALL define first-class daemon lifecycle contracts for runtime registration and task execution lifecycle semantics before phase-8 endpoint cutover.

#### Scenario: Runtime registration contract is explicit
- **WHEN** phase-8 daemon ownership artifacts are reviewed
- **THEN** Rust code includes explicit runtime registration fields (`runtime_id`, `daemon_id`, `workspace_id`, provider/runtime status)
- **AND** the contract supports online/degraded/offline status transitions.

#### Scenario: Runtime deregister semantics are explicit
- **WHEN** a runtime is deregistered
- **THEN** Rust contract logic marks the runtime as not registered
- **AND** runtime status transitions to offline deterministically.

#### Scenario: Task lifecycle transitions are deterministic
- **WHEN** a task transitions through daemon lifecycle states
- **THEN** Rust contract logic enforces deterministic transitions for `Queued -> Claimed -> Running -> Completed|Failed|Cancelled`
- **AND** invalid transitions are rejected with explicit errors.

#### Scenario: Task progress semantics are explicit
- **WHEN** a running task reports progress
- **THEN** Rust contract logic enforces monotonic progress sequence updates
- **AND** out-of-order progress reports are rejected.

### Requirement: Heartbeat TTL and stale lease semantics are testable
The Rust daemon contract layer SHALL model heartbeat timestamps and stale lease detection with predictable TTL behavior.

#### Scenario: Stale heartbeat is detected
- **WHEN** heartbeat age exceeds configured TTL
- **THEN** the daemon contract marks the lease as stale
- **AND** verification tests cover stale and fresh heartbeat paths.

### Requirement: Phase-8 remains rollback-safe
Phase-8 migration changes SHALL remain additive and fallback-safe while Python still owns business logic.

#### Scenario: Fallback posture is preserved
- **WHEN** phase-8 code is deployed
- **THEN** wildcard Python fallback routes remain available for rollback
- **AND** phase-8 changes do not require immediate Python module deletion.
