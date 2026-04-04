## 1. Specification

- [x] 1.1 Add OpenSpec change `show-tracked-sessions-working-now` for tracked-session working-now semantics.

## 2. Frontend implementation

- [x] 2.1 Update `isAccountWorkingNow` to treat `codexTrackedSessionCount > 0` as working.
- [x] 2.1.1 Keep compatibility fallback for payloads that still set `codexSessionCount`.
- [x] 2.2 Keep live-only telemetry visuals tied to fresh live telemetry.
- [x] 2.3 Update dashboard working section helper copy to reflect active CLI sessions.
- [x] 2.4 Prefer `liveQuotaDebug.merged` values for card quota bars and bypass floor clamping for merged values.
- [x] 2.5 Treat non-stale `liveQuotaDebug.rawSamples` as a working-now signal in frontend detection.

## 3. Validation

- [x] 3.1 Update unit/component tests for tracked-session working behavior.
- [x] 3.1.1 Add quota display coverage for merged debug values replacing stale `0%` floors.
- [x] 3.1.2 Add working-now and polling coverage for raw-sample-driven activity.
- [x] 3.2 Run targeted tests for working detection and dashboard cards.
- [x] 3.3 Run frontend lint and typecheck.
- [x] 3.4 Run `openspec validate --specs`.
