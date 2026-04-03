### ADDED Requirement: Snapshot email-name mismatch remediation actions
Accounts and Dashboard UI surfaces SHALL provide direct remediation actions when a resolved snapshot name does not match the expected email-derived snapshot name.

#### Scenario: Accounts detail shows snapshot repair actions for mismatch
- **WHEN** an account has a resolved `codexAuth.snapshotName` and `codexAuth.snapshotNameMatchesEmail = false`
- **THEN** the Accounts detail actions include:
  - `Re-add snapshot`
  - `Rename snapshot`
- **AND** each action calls the snapshot repair API with the corresponding mode.

#### Scenario: Dashboard card shows snapshot repair actions for mismatch
- **WHEN** a dashboard account card has a resolved `codexAuth.snapshotName` and `codexAuth.snapshotNameMatchesEmail = false`
- **THEN** the card actions include:
  - `Re-add snapshot`
  - `Rename snapshot`
- **AND** each action calls the snapshot repair API with the corresponding mode.

