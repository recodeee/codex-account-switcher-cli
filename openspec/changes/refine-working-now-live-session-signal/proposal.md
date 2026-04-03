## Why
The dashboard and account list currently treat an active local snapshot as "Working now" even when no Codex session is actually running. This creates false-positive live badges and overly aggressive polling. Session counters also include stale codex-session mappings, which can overstate live CLI activity.

## What Changes
- Refine `Working now` semantics to only include:
  - runtime live session telemetry (`codexAuth.hasLiveSession`), or
  - active tracked codex sessions (`codexSessionCount > 0`).
- Stop treating `codexAuth.isActiveSnapshot` by itself as a live signal.
- Count `codexSessionCount` from fresh codex-session mappings only (active recency window), so stale mappings do not inflate UI counters.
- Update frontend/backend tests to lock the new behavior.

## Impact
- "Working now" and list "Live" badges only appear for real session activity.
- Dashboard/accounts polling uses fast refresh only when activity is actually live.
- Codex CLI session counters better match current, active session state.
