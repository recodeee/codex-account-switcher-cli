# Plan Summary: dashboard-live-usage-websocket

- **Mode:** ralplan
- **Status:** in_review
- **Task:** Improve dashboard `live_usage` quality and move dashboard overview updates to websocket-driven invalidation instead of polling-only refresh.

## Context

The dashboard currently refreshes `live_usage` and task previews through periodic polling (`5s` active / `30s` idle) from `GET /api/dashboard/overview`.

Evidence:
- Backend overview source: `app/modules/dashboard/api.py` + `app/modules/dashboard/service.py`.
- Frontend polling hook: `apps/frontend/src/features/dashboard/hooks/use-dashboard.ts`.
- Task preview sanitization exists in `app/modules/accounts/codex_live_usage.py`, but recent live samples still show orchestration wrappers (`<skill>`, `<hook_prompt>`, `<subagent_notification>`) in session previews.

## RALPLAN-DR Snapshot

### Principles

1. **Keep overview truth centralized** in existing `/api/dashboard/overview` response path.
2. **Use websocket as an invalidation channel**, not a duplicate payload transport.
3. **Fail closed on auth + parsing** (no unauthenticated websocket stream; ignore malformed preview wrappers safely).
4. **Preserve locked dashboard behavior** (CLI session detection cascade order and existing account-card semantics stay unchanged).
5. **Degrade gracefully**: fallback polling continues when websocket is unavailable.

### Decision Drivers (Top 3)

1. Reduce stale `live_usage`/task-preview UI lag without increasing backend compute blast radius.
2. Prevent orchestration/system wrappers from leaking into user-facing task preview text.
3. Keep changes reversible and bounded (additive endpoint + focused sanitizer deltas + targeted tests).

### Viable Options

- **Option A:** Full overview payload over websocket.
  - Pros: fewer client roundtrips after connection.
  - Cons: duplicate serialization path, schema drift risk, larger stateful server complexity.
- **Option B (chosen):** Websocket invalidation events + existing REST overview fetch.
  - Pros: minimal contract surface, reuses mature query/schema path, easier rollback.
  - Cons: still needs REST fetch after events.
- **Option C:** Polling-only tuning (shorter intervals).
  - Pros: no new transport.
  - Cons: constant load increase; does not solve stale push latency cleanly.

### Why Option B

Option B gives near-live updates with lowest architecture risk: websocket only announces change events, and client reuses existing validated overview parser/schema path.

## Execution Update (2026-04-08)

- Confirmed the planned implementation is present in scoped backend/frontend files:
  - `/api/dashboard/overview/ws` route + invalidation stream (`app/modules/dashboard/api.py`, `app/modules/dashboard/live_updates.py`)
  - shared fail-closed websocket auth helper reuse (`app/core/auth/dependencies.py`, `app/modules/accounts/api.py`)
  - control-wrapper stripping for task previews (`app/modules/accounts/codex_live_usage.py`)
  - frontend websocket invalidation + safety polling fallback (`use-dashboard-live-socket.ts`, `use-dashboard.ts`)
- Verification evidence:
  - Focused backend websocket/sanitizer tests: **pass** (`5 passed`)
  - Focused frontend dashboard hook tests: **pass** (`8 passed`)
  - `openspec validate --specs`: **pass**
- Known blocker (non-scope / pre-existing dirty workspace): broader integration and frontend account-card/typecheck suites currently fail in files already modified before this resume session.
