## ADDED Requirements

### Requirement: Dashboard groups active accounts in a dedicated working section
When at least one dashboard account is actively working, the Accounts area SHALL render those active cards in a dedicated top section before the rest of the account list.

#### Scenario: Working accounts appear first
- **WHEN** dashboard overview data contains one or more accounts that satisfy the `Working now` criteria
- **THEN** the Accounts area renders a `Working now` section first
- **AND** only working accounts are rendered in that section
- **AND** non-working accounts are rendered in a separate lower section

### Requirement: Working account 5h usage shows live status
The dashboard 5h quota panel SHALL expose explicit live-state affordances when an account is currently working so operators can see the token status is actively updating.

#### Scenario: Live 5h status is shown for a working account
- **WHEN** an account is currently marked `Working now`
- **THEN** its 5h quota panel displays a live status indicator
- **AND** the account token usage panel displays a live token-status affordance

### Requirement: Dashboard overview polling accelerates while work is active
The dashboard overview polling cadence SHALL be faster when any account is currently working, and SHALL fall back to the default cadence when no account is working.

#### Scenario: Active work uses faster overview refresh
- **WHEN** any dashboard account is currently marked `Working now`
- **THEN** dashboard overview refetches on an accelerated interval
- **AND** once no accounts are working, polling returns to the default interval
