## ADDED Requirements

### Requirement: Rust runtime scheduler lifecycle provides Python-parity start semantics
The Rust runtime SHALL provide scheduler lifecycle controls that mirror Python scheduler start behavior for background jobs.

#### Scenario: Start ignores disabled jobs and avoids duplicate tasks
- **GIVEN** a scheduler lifecycle with enabled and disabled jobs
- **WHEN** start is invoked
- **THEN** disabled jobs are not spawned
- **AND** already-running enabled jobs are not spawned again.

### Requirement: Rust runtime scheduler lifecycle provides Python-parity stop semantics
The Rust runtime SHALL provide scheduler stop behavior that mirrors Python scheduler stop behavior for background jobs.

#### Scenario: Stop signals shutdown and cancels running task
- **GIVEN** a running background job task
- **WHEN** stop is invoked for that job
- **THEN** stop state is signaled
- **AND** the task is cancelled/aborted and awaited
- **AND** lifecycle state no longer marks the job as running.

### Requirement: Rust runtime shutdown stops scheduler jobs in reverse registration order
The Rust runtime SHALL stop registered scheduler jobs in reverse order during shutdown to preserve Python lifespan shutdown ordering.

#### Scenario: Shutdown requests reverse-order stop
- **GIVEN** scheduler jobs are started in registration order
- **WHEN** runtime shutdown lifecycle stop-all is invoked
- **THEN** stop is requested in reverse registration order
- **AND** running jobs transition to stopped state.
