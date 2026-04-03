## ADDED Requirements

### Requirement: Safe non-matching Codex session reconciliation CLI

The system SHALL provide a local operator CLI that can reconcile running Codex sessions by restarting only sessions that do not match a selected keep-session fingerprint.

#### Scenario: Dry-run reports restart candidates without killing sessions

- **WHEN** the operator runs reconciliation without `--apply`
- **THEN** the tool identifies keep/match/restart decisions
- **AND** no running process is terminated

#### Scenario: Apply mode performs graceful restart for non-matching sessions

- **WHEN** reconciliation runs with `--apply` and restart candidates exist
- **THEN** each candidate receives SIGTERM first
- **AND** candidates still alive after the grace window receive SIGKILL
- **AND** the keep session is never terminated

#### Scenario: Default scope protects unrelated sessions

- **WHEN** reconciliation runs with default settings
- **THEN** only sessions in the current repository scope are eligible for restart
- **AND** sessions outside scope are reported as skipped

#### Scenario: Ambiguous session mapping is skipped for safety

- **WHEN** a running process cannot be mapped uniquely to a rollout session/fingerprint
- **THEN** that process is marked as skipped
- **AND** it is not terminated in apply mode
