## MODIFIED Requirements

### Requirement: React dashboard preserves current operational account controls
The React dashboard SHALL preserve the existing operational controls for account cards, account details, and session-management flows while surfacing new runtime metadata in a guarded, operator-readable way.

#### Scenario: Account cards render checkpoint continuation affordances
- **GIVEN** the backend reports a `ready`, `resumed`, or `expired` runtime checkpoint for an account/runtime
- **WHEN** the operator views that account in the dashboard
- **THEN** the UI renders the checkpoint status with source/runtime provenance and guarded continue/resume affordances
- **AND** existing live-session, task-preview, and quota badges continue to behave as before for accounts without checkpoint metadata
