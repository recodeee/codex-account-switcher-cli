## ADDED Requirements

### Requirement: Accounts sidebar rows show 5h and Weekly quota inline
The Accounts page sidebar SHALL display compact quota summaries in each account row with `5h` shown above `Weekly`.

#### Scenario: Sidebar quota ordering is 5h then Weekly
- **WHEN** the Accounts page renders account rows in the left sidebar
- **THEN** each row shows a `5h` quota summary first
- **AND** the `Weekly` quota summary is shown directly under it

### Requirement: Accounts sidebar prioritizes immediately usable accounts
The Accounts page sidebar SHALL prioritize accounts that are currently eligible for `Use this`, then order by available 5h quota.

#### Scenario: Usable accounts are ordered first by highest 5h remaining
- **WHEN** the sidebar contains accounts where some rows have `Use this` enabled and others disabled
- **THEN** enabled rows appear before disabled rows
- **AND** rows in the same enabled/disabled group are ordered by descending 5h remaining percentage
- **AND** ties are resolved by descending Weekly remaining, then email ascending
