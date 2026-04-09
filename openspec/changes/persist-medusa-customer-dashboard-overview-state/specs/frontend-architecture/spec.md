## MODIFIED Requirement: Medusa customer auth gate controls dashboard entry
The application SHALL gate dashboard routes behind Medusa customer authentication and maintain customer-scoped dashboard overview snapshots in Medusa-backed metadata.

#### Scenario: Dashboard overview snapshot is stored per authenticated Medusa customer
- **WHEN** an authenticated Medusa customer has a successful dashboard overview response
- **THEN** the frontend saves the serialized overview payload into that customer's Medusa metadata under a codex-lb owned key
- **AND** the write is best-effort so live dashboard rendering is not blocked by metadata failures

#### Scenario: Dashboard overview hydrates from customer metadata before live fetch settles
- **WHEN** an authenticated Medusa customer opens the dashboard and a valid saved overview snapshot exists in Medusa metadata
- **THEN** the frontend hydrates the dashboard overview query cache from that snapshot
- **AND** live polling still runs and replaces the hydrated snapshot when newer server data arrives
