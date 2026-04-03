## ADDED Requirements

### Requirement: Fingerprint fallback can refresh per-account live quota bars when reset attribution is unique
When local default-session telemetry is mixed and fallback fingerprint matching is used, the backend SHALL allow per-account quota overrides when the matched sample has a unique reset fingerprint for that account.

#### Scenario: Unique reset fingerprint updates account quota bars
- **WHEN** fallback sample matching maps a live sample to an account
- **AND** the sample reset fingerprint uniquely matches that account among candidate accounts
- **THEN** the account is marked live
- **AND** the account 5h/weekly usage windows are updated from that sample

#### Scenario: Ambiguous reset fingerprint does not overwrite quota bars
- **WHEN** fallback sample matching maps live sessions but reset fingerprints are not unique across accounts
- **THEN** live-session presence/count is still updated
- **AND** quota windows remain on baseline persisted values
