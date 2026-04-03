### ADDED Requirement: Dashboard account card snapshot visibility
Dashboard account cards SHALL show codex-auth snapshot mapping status inline in the subtitle.

#### Scenario: Dashboard card has mapped snapshot
- **WHEN** a dashboard account card has a resolved `codexAuth.snapshotName`
- **THEN** the subtitle includes `<Plan Label> · <snapshotName>`

#### Scenario: Dashboard card has no mapped snapshot
- **WHEN** a dashboard account card has no resolved `codexAuth.snapshotName`
- **THEN** the subtitle includes `<Plan Label> · No snapshot`
