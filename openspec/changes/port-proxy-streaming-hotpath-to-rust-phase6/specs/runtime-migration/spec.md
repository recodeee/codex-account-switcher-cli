## ADDED Requirements

### Requirement: Rust wildcard proxy preserves stream-style response contracts
The Rust runtime wildcard proxy routes (`/api/{*path}`, `/backend-api/{*path}`, `/v1/{*path}`) SHALL forward upstream response bodies without pre-buffering the full payload and SHALL preserve upstream response metadata required by clients.

#### Scenario: Upstream event-stream content is passed through
- **WHEN** a client sends `POST /v1/events` to the Rust runtime and the Python upstream responds with `content-type: text/event-stream` and event body frames
- **THEN** the Rust runtime returns HTTP 200
- **AND** the response `content-type` remains `text/event-stream`
- **AND** upstream `set-cookie` headers are preserved.

### Requirement: Wildcard proxy remains fail-closed on upstream request failure
Wildcard forwarding SHALL continue returning a fail-closed JSON 503 contract when upstream requests cannot be completed.

#### Scenario: Upstream wildcard target is unreachable
- **WHEN** a request is made to a wildcard route and the configured Python upstream cannot be reached
- **THEN** the Rust runtime returns HTTP 503 with a JSON `detail` field
- **AND** no success payload is emitted.
