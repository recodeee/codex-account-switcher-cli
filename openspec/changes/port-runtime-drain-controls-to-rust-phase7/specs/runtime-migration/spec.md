## ADDED Requirements

### Requirement: Rust runtime graceful drain tracks finite HTTP in-flight requests
The Rust runtime SHALL track finite HTTP in-flight requests and wait for drain completion during shutdown before final termination.

#### Scenario: Shutdown waits for finite HTTP request drain up to configured timeout
- **WHEN** shutdown signal is received by the Rust runtime
- **THEN** runtime marks draining and bridge-drain-active before server exit
- **AND** waits for in-flight HTTP request count to reach zero until `RUST_RUNTIME_SHUTDOWN_DRAIN_TIMEOUT_SECONDS` elapses.

### Requirement: Rust responses bridge rejects new sessions during bridge drain
The Rust runtime SHALL fail closed for new responses bridge entry requests while bridge drain is active.

#### Scenario: Responses HTTP entrypoint is rejected while draining
- **WHEN** bridge drain is active and a request targets `/backend-api/codex/responses` or `/v1/responses`
- **THEN** Rust returns HTTP `503`
- **AND** response payload includes a JSON `detail` explaining bridge drain is active.

### Requirement: Rust readiness reports draining state from runtime lifecycle
The Rust runtime SHALL treat lifecycle draining state as authoritative readiness input.

#### Scenario: Readiness is unavailable while runtime lifecycle is draining
- **WHEN** lifecycle draining is true
- **THEN** `GET /health/ready` returns HTTP `503`
- **AND** response detail is `Service is draining`.
