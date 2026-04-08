## MODIFIED Requirements

### Requirement: Dashboard exposes sticky-session administration
The system SHALL provide dashboard APIs for listing sticky-session mappings, deleting one mapping, and purging stale mappings.

#### Scenario: Runtime checkpoint visibility accompanies session operations
- **WHEN** the dashboard requests account/runtime operational state for sticky-session-related views
- **THEN** the response may include additive checkpoint readiness/status metadata for the same runtime/account
- **AND** that metadata does not mutate or overload the persisted sticky-session `kind` model
- **AND** operators can distinguish sticky-session state from checkpoint resume state
