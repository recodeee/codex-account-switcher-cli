## Why

`/projects/plans` currently shows only static OpenSpec markdown artifacts. During `$ralplan` and follow-up execution flows, operators need a live runtime observer in the same view so they can see which session is active, which lanes/agents/models are running, and where planning stopped when a runtime/account lane errors.

Without a dedicated runtime contract, observers must infer state from ad hoc logs, which is brittle and does not provide deterministic resume guidance.

## What Changes

- Add a backend runtime observer endpoint: `GET /api/projects/plans/{plan_slug}/runtime`.
- Correlate plan workspaces to OMX sessions with fail-closed behavior and explicit reason codes.
- Parse authoritative structured agent events when available and expose normalized agent roster + timeline payloads.
- Surface persisted resume metadata (`lastCheckpoint`, `lastError`, `canResume`) for deterministic continuation.
- Add a frontend live observer card in Plans detail, including active/inactive status, lane cards, timeline, and fallback states.

## Impact

- Plan operators can monitor live planning/execution from the dashboard without switching panes.
- Missing telemetry no longer breaks the Plans UI; it degrades with explicit unavailable reasons.
- Existing static summary/checkpoint rendering remains intact.
