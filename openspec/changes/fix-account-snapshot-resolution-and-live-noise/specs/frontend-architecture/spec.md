## ADDED Requirements

### Requirement: Accounts snapshot mapping prefers email-aligned snapshots
When account snapshot metadata conflicts, the dashboard SHALL prefer snapshots
whose names align with the account email-derived naming convention.

#### Scenario: Conflicting snapshots share account lineage
- **WHEN** multiple snapshots can resolve for an account and at least one snapshot
  name matches the account's email-derived snapshot name
- **THEN** `codexAuth.snapshotName` resolves to the email-aligned snapshot.

### Requirement: Working-now attribution avoids default fingerprint spread by default
Default-session fingerprint spreading SHALL be disabled unless explicitly enabled.

#### Scenario: No process attribution and fallback flag unset
- **WHEN** process-level session attribution is unavailable
- **AND** `CODEX_LB_DEFAULT_SESSION_FINGERPRINT_FALLBACK_ENABLED` is unset/false
- **THEN** the system MUST NOT spread session presence to unrelated accounts via
  default-session fingerprint assignment.
