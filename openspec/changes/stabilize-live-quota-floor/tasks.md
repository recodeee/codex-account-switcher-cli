## 1. Implementation

- [x] 1.1 Add per-account/window floor cache in frontend quota display normalization.
- [x] 1.2 Reset floor when reset cycle changes and keep stale-telemetry null behavior.
- [x] 1.3 Wire account IDs into dashboard/accounts call sites so the floor applies consistently.
- [x] 1.4 Add cache reset hooks for test isolation.
- [x] 1.5 Replace indefinite `Syncing live telemetry` card copy with `Telemetry pending` when live sessions exist but per-window telemetry timestamps are missing/stale.

## 2. Validation

- [x] 2.1 Add/extend unit tests for monotonic floor behavior and reset rollover.
- [x] 2.2 Run targeted frontend tests for quota display and account list surfaces.
- [x] 2.3 Run frontend typecheck and lint.

## 3. Runtime merge stabilization

- [x] 3.1 Merge same-snapshot runtime telemetry using max-used (lowest remaining) within a reset cycle.
- [x] 3.2 Keep reset-aware merge behavior so values only rise on cycle reset/new window.
- [x] 3.3 Add/extend backend unit tests for snapshot merge behavior.

## 4. Debug observability for quota attribution

- [x] 4.1 Add per-account API debug payload with raw terminal quota samples and selected merged value.
- [x] 4.2 Render per-card quota debug overlay in dashboard UI.
- [x] 4.3 Add env-gated backend logs describing merge/attribution decisions (`CODEX_LB_LIVE_USAGE_DEBUG=1`).
