# Plan Summary: plans-live-execution-observer

- **Mode:** ralplan
- **Status:** approved
- **Task:** Upgrade `/projects/plans` into a live planning observer that surfaces active session state, spawned agents/models, and timeline statuses while OMX/CLI planning runs.

## Context

Current Plans UI shows static workspace artifacts only (summary/checkpoints/role task markdown). During `$ralplan`, users need runtime observability in the same screen: who was spawned, which model each lane uses, what is waiting/finished, and whether planning is still active. They also need safe continuation when a runtime/account lane errors out: OMX must persist the last known checkpoint + error details so execution can resume deterministically.

## RALPLAN-DR Snapshot

### Principles

1. Keep plan artifacts as source-of-truth, but add runtime observability as a first-class companion.
2. Fail closed: when runtime telemetry is missing/unparseable, preserve existing plans UX and show explicit fallback state.
3. Prefer structured runtime events over brittle free-text scraping.
4. Never treat regex/free-text parsing as authoritative agent/model/status telemetry.
5. Keep UI readable: compact live cards + timeline list instead of dumping raw logs.

### Decision Drivers (Top 3)

1. Reliability of agent/model/status attribution.
2. Fast operator comprehension (who/what/where stalled) during planning.
3. Minimal disruption to existing OpenSpec plans list/detail behavior.

### Viable Options

- **Option A (chosen):** Add a dedicated backend runtime-observer payload for plan detail, combining state files + structured event stream (when available), with graceful fallback.
  - Pros: explicit contract, testable, supports live and recent history.
  - Cons: requires backend parsing/service additions.
- **Option B:** Parse raw CLI text snippets directly in frontend from generic logs.
  - Pros: fewer backend changes.
  - Cons: high drift risk, weak testability, poor security boundary.
- **Option C:** Show only current `ralplan-state` without timeline/agent roster.
  - Pros: simplest implementation.
  - Cons: misses key user ask (spawned names/models and status transitions).

### Why A

It is the only option that is robust enough for production UX while preserving existing API boundaries and allowing progressive telemetry improvement.
