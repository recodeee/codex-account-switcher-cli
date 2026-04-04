## 1. Specification

- [x] 1.1 Add OpenSpec change `show-tracked-sessions-working-now` for tracked-session working-now semantics.

## 2. Frontend implementation

- [x] 2.1 Update `isAccountWorkingNow` to treat `codexTrackedSessionCount > 0` as working.
- [x] 2.1.1 Keep compatibility fallback for payloads that still set `codexSessionCount`.
- [x] 2.2 Keep live-only telemetry visuals tied to fresh live telemetry.
- [x] 2.3 Update dashboard working section helper copy to reflect active CLI sessions.
- [x] 2.4 Prefer `liveQuotaDebug.merged` values for card quota bars and bypass floor clamping for merged values.
- [x] 2.5 Treat non-stale `liveQuotaDebug.rawSamples` as a working-now signal in frontend detection.
- [x] 2.6 Use fresh raw sample count as fallback `Codex CLI sessions` headline when counters are zero.
- [x] 2.7 Apply merged debug quota percentages on Accounts page sidebar/detail usage rows.
- [x] 2.8 Use conservative in-cycle merged quotas for disconnected deferred-snapshot accounts and persist provisional windows.

## 3. Validation

- [x] 3.1 Update unit/component tests for tracked-session working behavior.
- [x] 3.1.1 Add quota display coverage for merged debug values replacing stale `0%` floors.
- [x] 3.1.2 Add working-now and polling coverage for raw-sample-driven activity.
- [x] 3.1.3 Add coverage for raw-sample-driven session headline fallback and Accounts page merged weekly display.
- [x] 3.1.4 Add backend unit coverage for conservative deferred-snapshot merging/persistence behavior.
- [x] 3.2 Run targeted tests for working detection and dashboard cards.
- [x] 3.3 Run frontend lint and typecheck.
- [x] 3.4 Run `openspec validate --specs`.
