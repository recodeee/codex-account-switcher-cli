### CHANGED Requirement: Dashboard page
The Dashboard account card primary local-switch action SHALL indicate when an account is already the currently selected local snapshot.

#### Scenario: Active snapshot card shows current-state label
- **WHEN** a dashboard account card renders for an account whose `codexAuth.isActiveSnapshot` is `true`
- **THEN** the primary action label reads `Currently used`
- **AND** the card keeps the existing success styling for the local-switch action.

#### Scenario: Pending switch keeps action label
- **WHEN** a dashboard account card renders while a local switch is in progress for a non-active snapshot account
- **THEN** the primary action label remains `Use this account`
- **AND** the pending success icon still appears.
