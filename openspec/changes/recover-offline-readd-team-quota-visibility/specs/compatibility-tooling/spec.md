## MODIFIED Requirements

### Requirement: Dashboard per-account local codex-auth switch

The dashboard and accounts surfaces SHALL keep local Codex auth state aligned with validated snapshot ownership so operators can trust the displayed token/quota state.

#### Scenario: Workspace-disconnected account silently recovers after rejoining a paid/team plan

- **GIVEN** an account was previously marked disconnected because workspace membership was removed
- **AND** a local codex-auth snapshot for that same email/account now reports a non-free paid/team plan again
- **WHEN** the accounts or dashboard overview APIs poll and auto-import local codex-auth snapshots
- **THEN** the account is silently reactivated
- **AND** normal usage refresh resumes so the token/quota card can show current state without manual repair

#### Scenario: Workspace downgrade shield remains fail-closed

- **GIVEN** an account is still disconnected because the upstream usage payload downgraded a workspace account to `free`
- **WHEN** local snapshot polling does not provide validated paid/team recovery evidence
- **THEN** the account remains disconnected
- **AND** the dashboard does not surface stale or unrelated free-tier quota data as a recovered team state

#### Scenario: API payload exposes validated runtime readiness metadata

- **WHEN** an account payload includes codex-auth status
- **THEN** it includes backend-authored readiness fields derived from validated snapshot reconciliation
- **AND** readiness is true only when the selected snapshot exists and matches the account email identity
