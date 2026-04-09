## ADDED Requirements

### Requirement: Rust phase-0 runtime scaffold
The repository SHALL provide a Rust runtime scaffold under `rust/codex-lb-runtime` that can run independently and expose health/readiness parity endpoints for migration experiments.

#### Scenario: Rust runtime health endpoint parity
- **WHEN** the Rust runtime scaffold is running
- **THEN** `GET /health` returns HTTP 200 with a JSON payload that includes `status: "ok"`
- **AND** `GET /health/live` returns HTTP 200 with a JSON payload that includes `status: "ok"`
- **AND** `GET /health/ready` returns HTTP 200 with a JSON payload that includes `status: "ok"` and a runtime check entry
- **AND** `GET /health/startup` returns HTTP 200 with a JSON payload that includes `status: "ok"`

#### Scenario: Rust runtime identity endpoint
- **WHEN** `GET /_rust_layer/info` is called
- **THEN** the endpoint returns HTTP 200 with runtime identity fields including implementation language and service name

#### Scenario: Rust runtime root health panel
- **WHEN** `GET /` is opened in a browser
- **THEN** the endpoint returns HTTP 200 HTML showing a visible runtime health panel
- **AND** the panel includes a healthy/running status message with links to `/health`, `/health/live`, and `/_rust_layer/info`

### Requirement: Phase-0 runtime comparison tool
The repository SHALL provide a comparison utility to benchmark and compare response parity between Python and Rust runtime endpoints before any traffic cutover.

#### Scenario: Comparison script emits machine-readable results
- **WHEN** `scripts/rust_runtime/compare_runtime.py` is run with Python and Rust base URLs
- **THEN** the script outputs per-endpoint status and latency summaries for each runtime
- **AND** the output includes response body hash comparisons for parity checks
