## ADDED Requirements

### Requirement: Dashboard live Codex telemetry supports concurrent runtime profiles
Dashboard/account responses SHALL apply local live Codex usage/session overrides per snapshot across runtime-scoped auth profiles.

#### Scenario: Two runtimes with different snapshots both expose live quotas
- **WHEN** runtime `terminal-a` is set to snapshot `work` and runtime `terminal-b` is set to snapshot `personal`
- **AND** both runtime session directories have active rollout telemetry
- **THEN** dashboard account summaries for `work` and `personal` each use their own live 5h/weekly values
- **AND** each account receives its own live Codex session count override

#### Scenario: Runtime live activity sets working indicator per account
- **WHEN** an account snapshot has active live runtime sessions
- **THEN** account payload includes runtime-live-session state for that account
- **AND** dashboard account cards can show `Working now` for multiple accounts concurrently
