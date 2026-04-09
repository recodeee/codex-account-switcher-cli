## ADDED Requirements

### Requirement: Dev launcher uses Python runtime only
The root developer launcher SHALL run a Python-only runtime path and SHALL not attempt to spawn a separate Rust runtime process.

#### Scenario: Python-only startup output
- **WHEN** an operator runs `bash ./scripts/dev-all.sh`
- **THEN** the ready output lists `runtime` as the app API URL with a `python` label
- **AND** startup does not require `cargo`
- **AND** Rust-specific log-watch hints are not printed.

### Requirement: Rust runtime layer artifacts are removed
The repository SHALL not ship the Rust HTTP runtime crate or its launcher/guardrail helpers.

#### Scenario: Workspace excludes Rust runtime crate
- **WHEN** `rust/Cargo.toml` workspace members are inspected
- **THEN** `codex-lb-runtime` is not listed as a member.

#### Scenario: Rust runtime helper scripts are absent
- **WHEN** repository scripts are inspected
- **THEN** `scripts/run-rust-runtime-dev.sh` and `scripts/verify-rust-runtime-guardrails.sh` are absent
- **AND** `scripts/dev-logs.sh` does not advertise a Rust log target.

### Requirement: Python compatibility diagnostics remain available
Python SHALL continue exposing runtime compatibility diagnostics for existing probes.

#### Scenario: Runtime compatibility endpoints remain functional
- **WHEN** `GET /_rust_layer/info`, `GET /_python_layer/health`, and `GET /_python_layer/apis` are called against the Python app
- **THEN** each endpoint returns HTTP 200
- **AND** `_rust_layer/info` reports `language: python`.
