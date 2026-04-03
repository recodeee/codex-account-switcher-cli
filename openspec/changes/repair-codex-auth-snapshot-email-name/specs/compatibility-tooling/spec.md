### ADDED Requirement: Repair codex-auth snapshot names to email-derived canonical names
The accounts API SHALL support repairing resolved codex-auth snapshot names to an email-derived canonical format.

#### Scenario: Re-add repaired snapshot under canonical email name
- **WHEN** `POST /api/accounts/{account_id}/repair-snapshot?mode=readd` is called for an account with a resolved snapshot name that differs from the canonical email-derived name
- **THEN** the API copies the resolved snapshot to the canonical name
- **AND** updates active local pointers to the canonical snapshot
- **AND** returns `status = "repaired"` with `mode = "readd"` and both previous and new snapshot names.

#### Scenario: Rename repaired snapshot under canonical email name
- **WHEN** `POST /api/accounts/{account_id}/repair-snapshot?mode=rename` is called for an account with a resolved snapshot name that differs from the canonical email-derived name
- **THEN** the API moves the resolved snapshot to the canonical name
- **AND** updates active local pointers to the canonical snapshot
- **AND** returns `status = "repaired"` with `mode = "rename"` and both previous and new snapshot names.

#### Scenario: Repair target snapshot already exists
- **WHEN** repair is requested and the canonical target snapshot file already exists
- **THEN** the API returns a conflict error and does not overwrite the existing target snapshot.

