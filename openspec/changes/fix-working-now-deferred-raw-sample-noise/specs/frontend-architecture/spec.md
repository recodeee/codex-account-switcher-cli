## MODIFIED Requirements
### Requirement: Dashboard page
The Dashboard page SHALL display: summary metric cards (requests 7d, tokens, cost, error rate), primary and secondary usage donut charts with legends, account status cards grid, and a recent requests table with filtering and pagination.

#### Scenario: Deferred mixed-session raw samples do not mark working-now by themselves
- **WHEN** account payload has `liveQuotaDebug.overrideReason` starting with `deferred_active_snapshot_mixed_default_sessions`
- **AND** `codexLiveSessionCount = 0`
- **AND** `codexTrackedSessionCount = 0`
- **AND** `codexSessionCount = 0`
- **AND** `codexAuth.hasLiveSession = false`
- **THEN** raw debug sample presence alone SHALL NOT mark the account as `Working now`.

#### Scenario: Non-deferred raw samples still support working-now fallback
- **WHEN** account payload has fresh non-stale `liveQuotaDebug.rawSamples`
- **AND** the override reason is not deferred mixed-default-session mode
- **AND** live/tracked counters are currently zero
- **THEN** the account MAY still be treated as `Working now` through raw-sample fallback.
