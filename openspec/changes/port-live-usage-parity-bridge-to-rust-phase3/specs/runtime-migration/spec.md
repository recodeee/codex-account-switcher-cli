## ADDED Requirements

### Requirement: Rust live usage parity bridge behavior
The Rust runtime SHALL provide Phase-3 live-usage parity by proxying Python live-usage XML endpoints while preserving reversible fallback behavior.

#### Scenario: Rust live usage endpoint proxies Python XML payload
- **WHEN** Python live usage endpoint is reachable
- **AND** `GET /live_usage` is called on the Rust runtime
- **THEN** Rust returns the upstream HTTP status code
- **AND** the response payload is XML from the upstream endpoint
- **AND** the response includes `Cache-Control: no-store`.

#### Scenario: Rust live usage mapping endpoint forwards minimal query parameter
- **WHEN** Python mapping endpoint is reachable
- **AND** `GET /live_usage/mapping?minimal=true` is called on the Rust runtime
- **THEN** Rust forwards the `minimal=true` query parameter upstream
- **AND** Rust returns XML payload content from the upstream endpoint.

#### Scenario: Rust live usage endpoints fail gracefully when Python is unavailable
- **WHEN** Python live usage endpoints are unavailable
- **AND** `GET /live_usage` or `GET /live_usage/mapping` is called on the Rust runtime
- **THEN** Rust returns XML fallback payloads
- **AND** the response includes `Cache-Control: no-store`.

### Requirement: Runtime comparison utility supports XML parity normalization
The parity comparison utility SHALL support canonical XML comparison for dynamic live-usage payloads.

#### Scenario: XML payload parity ignores generated_at volatility
- **WHEN** `scripts/rust_runtime/compare_runtime.py` compares XML endpoints with dynamic `generated_at` timestamps
- **THEN** canonical XML comparison normalizes volatile timestamp values
- **AND** strict mode only fails when substantive XML contract differences remain.
