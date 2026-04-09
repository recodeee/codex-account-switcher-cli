## ADDED Requirements

### Requirement: Rust layer exposes Python bridge health rollup
The Rust runtime SHALL expose a Python-layer rollup endpoint for migration-time operability.

#### Scenario: Bridge health is healthy when all Python probes succeed
- **WHEN** `GET /_python_layer/health` is called
- **AND** Python `/health`, `/health/live`, `/health/ready`, and `/health/startup` all return success statuses
- **THEN** the Rust endpoint returns HTTP 200
- **AND** the JSON payload includes `status: "ok"`
- **AND** each probed endpoint is listed with `ok: true`.

#### Scenario: Bridge health fails closed when any Python probe fails
- **WHEN** `GET /_python_layer/health` is called
- **AND** at least one probed Python endpoint returns non-success or request error
- **THEN** the Rust endpoint returns HTTP 503
- **AND** the JSON payload includes `status: "degraded"`
- **AND** the failing endpoint entry includes `ok: false` and a diagnostic detail string.

### Requirement: Python bridge probe configuration is runtime-controlled
The Rust runtime SHALL support environment-based configuration for Python bridge probing.

#### Scenario: Custom base URL is honored
- **WHEN** `PYTHON_RUNTIME_BASE_URL` is set
- **THEN** `/_python_layer/health` probes Python endpoints using that base URL.

#### Scenario: Probe timeout is configurable
- **WHEN** `RUST_RUNTIME_PYTHON_TIMEOUT_MS` is set to a positive integer
- **THEN** Rust uses that value as the per-request Python probe timeout.

### Requirement: Rust runtime exposes live Python API catalog for panel visibility
The Rust runtime SHALL expose discovered Python API paths and render them in the runtime panel.

#### Scenario: Python API catalog endpoint returns OpenAPI-derived paths
- **WHEN** `GET /_python_layer/apis` is called
- **AND** Python `openapi.json` is reachable and valid
- **THEN** Rust returns HTTP 200
- **AND** payload includes `status: "ok"` with sorted `paths` values discovered from OpenAPI.

#### Scenario: Python API catalog fails closed on OpenAPI failure
- **WHEN** `GET /_python_layer/apis` is called
- **AND** Python `openapi.json` is unreachable, invalid, or returns non-success
- **THEN** Rust returns HTTP 503
- **AND** payload includes `status: "degraded"` and a non-empty `detail` field.

#### Scenario: Root panel always shows current Python API links
- **WHEN** `GET /` is opened
- **THEN** the page includes a “Python APIs (live from OpenAPI)” section
- **AND** the section fetches `/_python_layer/apis` and renders link rows for each returned Python path.
