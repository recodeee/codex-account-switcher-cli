## MODIFIED Requirements

### Requirement: Account-to-snapshot mapping is single-valued
Account snapshot resolution SHALL return at most one effective codex-auth snapshot name for any account.

#### Scenario: Selected snapshot remains authoritative downstream
- **WHEN** account auth status resolves a selected snapshot name
- **AND** the raw snapshot index bucket still contains stale alias names
- **THEN** downstream live-usage override/debug flows consume only the selected snapshot name
- **AND** dashboard `snapshots=` output remains single-valued.

#### Scenario: Active snapshot wins prefix ambiguity
- **WHEN** multiple snapshot names match the same email local-part prefix
- **AND** one of those candidates is the active snapshot
- **THEN** snapshot selection prefers the active snapshot candidate
- **AND** account switching/debug attribution does not jump back to the shortest alias.
