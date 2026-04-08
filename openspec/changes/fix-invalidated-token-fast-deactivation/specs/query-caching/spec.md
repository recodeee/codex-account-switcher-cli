## ADDED Requirements

### Requirement: Invalidated-token 401 failures deactivate immediately after retry
When usage polling receives a `401` response with an invalidated-token marker, the system SHALL still attempt one forced token refresh + usage retry when auth refresh is available. If the retry path still produces an invalidated-token `401`, the account SHALL be deactivated immediately (without waiting for the generic repeated-client-error threshold).

#### Scenario: Invalidated-token 401 still fails after forced refresh retry
- **WHEN** the first usage fetch returns `401` with an invalidated-token marker
- **AND** forced refresh succeeds
- **AND** the immediate retry usage fetch still returns `401` with an invalidated-token marker
- **THEN** the account is deactivated on that same refresh pass
- **AND** the generic client-error streak threshold is not required for this invalidated-token path.

#### Scenario: Non-invalidated client errors still use repeated-failure threshold
- **WHEN** usage fetch returns a deactivation-worthy non-invalidated client error (for example `402`)
- **THEN** the system keeps the existing repeated-failure streak threshold behavior before deactivation.
