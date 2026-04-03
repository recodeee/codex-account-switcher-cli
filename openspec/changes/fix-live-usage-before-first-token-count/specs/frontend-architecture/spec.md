## ADDED Requirements

### Requirement: Dashboard live usage is available before first token_count event
When an account has an active local Codex session but its newest rollout file has not emitted a `token_count` event yet, dashboard/account responses SHALL still mark the account as live and SHALL use the most recent known local rate-limit snapshot when available.

#### Scenario: New active rollout file has no token_count yet
- **WHEN** the selected account has an active rollout file with no `token_count` payload yet
- **AND** a nearby rollout file contains a recent valid rate-limit payload
- **THEN** the account response marks the account as having a live Codex session
- **AND** the account usage values use the most recent known local rate-limit snapshot instead of waiting for the first new message

#### Scenario: Multiple active default rollout sessions map to multiple accounts
- **WHEN** multiple active rollout files exist in the default local sessions directory
- **AND** each file has a usable rate-limit reset fingerprint that uniquely matches different account usage fingerprints
- **THEN** dashboard/account responses can mark multiple accounts as live concurrently
- **AND** each matched account receives its own session count and usage override instead of assigning all activity to only the currently active snapshot

#### Scenario: Sticky-session rows do not mark accounts as live without telemetry
- **WHEN** an account has persisted sticky-session rows but no active local/runtime rollout telemetry
- **THEN** `codexAuth.hasLiveSession` remains `false`
- **AND** `codexSessionCount` still reflects the persisted sticky-session count
- **AND** usage bars remain DB-derived for that account

#### Scenario: Telemetry session count takes precedence over sticky-session fallback
- **WHEN** an account has both active local/runtime telemetry and persisted sticky-session rows
- **THEN** `codexSessionCount` uses the telemetry-derived active-session count
- **AND** sticky-session counts do not inflate telemetry session counts
- **AND** telemetry-driven usage overrides still apply to both 5h and weekly windows when present
