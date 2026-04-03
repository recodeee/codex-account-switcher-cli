### ADDED Requirement: Redeploy applies memory safety guardrails
The redeploy workflow SHALL check host memory headroom before heavy Docker operations and prevent execution patterns that risk host instability.

#### Scenario: Redeploy aborts under critical memory pressure
- **WHEN** an operator runs `./redeploy.sh`
- **AND** both available RAM and available swap are below configured minimum thresholds
- **THEN** redeploy exits with an error before Docker build/restart execution
- **AND** prints a remediation message describing low-memory safeguards

#### Scenario: Redeploy auto-switches to serial build on low memory
- **WHEN** an operator runs `./redeploy.sh` in turbo mode
- **AND** available RAM is below the configured parallel-build minimum threshold
- **THEN** redeploy runs Docker build sequentially per selected service
- **AND** still completes service restart on successful builds

### ADDED Requirement: Redeploy supports explicit build-mode overrides
The redeploy workflow SHALL provide explicit controls to force serial or parallel Docker builds regardless of automatic memory-based selection.

#### Scenario: Force serial build
- **WHEN** an operator passes `--serial-build`
- **OR** sets `CODEX_LB_FORCE_SERIAL_BUILD=true`
- **THEN** redeploy uses sequential Docker builds for selected services

#### Scenario: Force parallel build
- **WHEN** an operator passes `--parallel-build`
- **OR** sets `CODEX_LB_FORCE_PARALLEL_BUILD=true`
- **THEN** redeploy uses parallel Docker builds for selected services
