# ExecPlan: dashboard-live-usage-websocket

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Follow repository guidance in `openspec/plan/PLANS.md`.

## Purpose / Big Picture

After this plan is implemented, dashboard cards update `live_usage`/task previews reactively through websocket invalidation events, while `/api/dashboard/overview` remains the single payload source. Task previews stop showing orchestration-control wrapper payloads in account/session rows.

## Progress

- [x] (2026-04-08 12:45Z) Captured current backend/frontend baseline and known stale-wrapper symptoms.
- [x] (2026-04-08 12:46Z) Evaluated options and selected websocket invalidation + REST fetch architecture.
- [x] (2026-04-08 12:47Z) Drafted implementation + verification plan with fail-closed auth and fallback polling.
- [x] (2026-04-08 19:20Z) Confirmed backend websocket observer, shared auth validator, frontend subscription hook, and sanitizer extension are present in implementation scope.
- [x] (2026-04-08 19:25Z) Ran focused verification bundle (`pytest` scoped websocket/sanitizer checks + frontend hook tests + `openspec validate --specs`).
- [x] (2026-04-08 19:25Z) Recorded broader baseline blockers outside scope (`test_dashboard_overview.py` and `apps/frontend/src/features/dashboard/components/account-card.test.tsx` dirty-worktree regressions).

## Surprises & Discoveries

- Observation: dashboard already has a websocket auth pattern (`/api/accounts/{id}/terminal/ws`) with explicit session-cookie validation helper local to accounts API.
  Evidence: `app/modules/accounts/api.py:229-294`.
- Observation: overview polling is fully centralized in `useDashboard` and already toggles interval by active-work signal.
  Evidence: `apps/frontend/src/features/dashboard/hooks/use-dashboard.ts:17-27`.
- Observation: preview sanitization already strips `<live_usage>` and bootstrap wrappers but does not explicitly strip orchestration wrappers from user-message text.
  Evidence: `app/modules/accounts/codex_live_usage.py:2695-2837`; tests at `tests/unit/test_codex_live_usage.py:2840-3193`.

## Decision Log

- Decision: implement websocket as **invalidation-only** channel; keep overview payload retrieval on existing REST endpoint.
  Rationale: avoids dual payload contracts and keeps one schema/parser path (`DashboardOverviewSchema`).
  Date/Author: 2026-04-08 / planner

- Decision: extend sanitizer for control-wrapper stripping (`<skill>`, `<hook_prompt>`, `<subagent_notification>`) in preview extraction path.
  Rationale: user-facing task preview should reflect actionable task text, not OMX control envelopes.
  Date/Author: 2026-04-08 / planner

## Outcomes & Retrospective

Execution handoff is complete with scoped verification evidence:

- Websocket invalidation-only architecture is implemented and exercised by integration tests.
- Fail-closed websocket auth helper is in place and reused by dashboard websocket route.
- Frontend invalidates `["dashboard","overview"]` on invalidation messages and keeps safety polling fallback.
- Control-wrapper preview sanitization is covered by focused unit tests.
- OpenSpec specs validate cleanly.

Known external blockers (not introduced in this execution lane):

- `tests/integration/test_dashboard_overview.py` contains failing baseline scenarios in the current workspace.
- `apps/frontend/src/features/dashboard/components/account-card.test.tsx` currently has unrelated failures and duplicate-key TypeScript errors in the dirty working tree.

## Context and Orientation

Relevant baseline code:

- Backend overview route/service
  - `app/modules/dashboard/api.py:17-21`
  - `app/modules/dashboard/service.py:50-312`
- Live usage + preview extraction/sanitization
  - `app/modules/accounts/codex_live_usage.py:147-206` (live usage by snapshot)
  - `app/modules/accounts/codex_live_usage.py:1180-1220` (session task previews)
  - `app/modules/accounts/codex_live_usage.py:2616-2673` (preview event extraction)
  - `app/modules/accounts/codex_live_usage.py:2695-2837` (sanitization and wrapper stripping)
- Existing websocket auth/streaming reference
  - `app/modules/accounts/api.py:229-294`
  - `app/modules/accounts/terminal.py:469-556`
- Frontend dashboard polling/query path
  - `apps/frontend/src/features/dashboard/api.ts:42-44`
  - `apps/frontend/src/features/dashboard/hooks/use-dashboard.ts:17-27`
  - `apps/frontend/src/features/dashboard/components/dashboard-page.tsx:29-64`

## Plan of Work

### Phase 0 — OpenSpec artifact alignment

1. Create/change OpenSpec artifact for dashboard live usage websocket behavior.
2. Record requirements + test obligations before touching implementation files.

### Phase 1 — Backend websocket invalidation endpoint

1. Add websocket route for dashboard overview updates (e.g., `/api/dashboard/overview/ws`) in `app/modules/dashboard/api.py`.
2. Add shared websocket dashboard-session validator in `app/core/auth/dependencies.py` and reuse in accounts/dashboard websocket routes.
3. Implement lightweight observer service (new module, e.g., `app/modules/dashboard/live_updates.py`) that:
   - computes a stable fingerprint from live-usage/session-preview inputs (no heavy DB refresh loop);
   - emits `{"type":"dashboard.overview.invalidate","reason":...,"ts":...}` only on fingerprint change;
   - emits periodic heartbeat for client liveness.
4. Keep fail-closed behavior:
   - unauthenticated websocket gets 4401/4403 close;
   - malformed source payloads do not crash stream loop.

### Phase 2 — Task preview quality improvements

1. Extend preview sanitizer pipeline in `app/modules/accounts/codex_live_usage.py` to remove control wrappers while preserving true task text.
2. Ensure wrappers are stripped both in full-block and inline forms.
3. Keep existing redaction and live_usage stripping behavior unchanged.

### Phase 3 — Frontend websocket subscription + fallback polling

1. Add dashboard websocket utility/hook (e.g., `apps/frontend/src/features/dashboard/hooks/use-dashboard-live-socket.ts`).
2. In `useDashboard` or `DashboardPage`, subscribe to websocket and invalidate `queryKey: ["dashboard","overview"]` on invalidate events.
3. Keep polling as fallback:
   - connected websocket: slower safety poll (for example 60s);
   - disconnected/error: current adaptive poll behavior (5s/30s).
4. Add reconnect with bounded backoff and cleanup on unmount.

### Phase 4 — Verification and regression gates

1. Backend tests for websocket auth and invalidation event semantics.
2. Unit tests for sanitizer wrapper stripping regressions.
3. Frontend tests for websocket-triggered invalidation + polling fallback.
4. Run OpenSpec validation.

## Concrete Steps

Run from repository root:

    cd /home/deadpool/Documents/codex-lb

1) OpenSpec/change artifacts:

    openspec new change dashboard-live-usage-websocket
    openspec validate --specs

2) Backend tests (targeted):

    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin \
      tests/integration/test_accounts_terminal_websocket.py \
      tests/integration/test_dashboard_overview.py \
      tests/unit/test_codex_live_usage.py -q

3) Frontend tests (targeted):

    cd apps/frontend
    bun run test -- \
      src/features/dashboard/hooks/use-dashboard-live-socket.test.ts \
      src/features/dashboard/hooks/use-dashboard.test.ts \
      src/features/dashboard/components/account-card.test.tsx \
      src/features/dashboard/components/account-cards.test.tsx
    cd ../..

4) Final spec check:

    openspec validate --specs

## Validation and Acceptance

Acceptance criteria:

1. Dashboard exposes authenticated websocket invalidation endpoint for overview updates.
2. When relevant live-usage/task-preview fingerprint changes, connected clients receive `dashboard.overview.invalidate` event.
3. Frontend invalidates/refetches overview on websocket event without manual refresh.
4. If websocket disconnects/fails, dashboard continues to refresh via existing polling fallback (no dead updates).
5. Task previews no longer surface wrapper control payloads (`<skill>`, `<hook_prompt>`, `<subagent_notification>`) while preserving actual user task text.
6. Existing locked CLI-session detection behavior remains unchanged (`hasActiveCliSessionSignal` cascade intact).

## Idempotence and Recovery

- Websocket endpoint is additive; rollback = disable route + remove client hook.
- REST overview remains unchanged, so websocket failure does not block dashboard functionality.
- Sanitizer changes are locally testable and reversible via targeted regex/function rollback.

## Artifacts and Notes

- Workspace: `openspec/plan/dashboard-live-usage-websocket/*`
- Delivery plan files:
  - `.omx/plans/prd-dashboard-live-usage-websocket.md`
  - `.omx/plans/test-spec-dashboard-live-usage-websocket.md`

## Interfaces and Dependencies

Proposed backend event shape:

```json
{
  "type": "dashboard.overview.invalidate",
  "reason": "live_usage_changed",
  "ts": "2026-04-08T12:47:00Z"
}
```

Optional heartbeat:

```json
{
  "type": "dashboard.overview.heartbeat",
  "ts": "2026-04-08T12:47:05Z"
}
```

## ADR (Decision Record)

- **Decision:** websocket invalidation events + existing REST overview fetch.
- **Drivers:** lower schema drift risk, simpler rollback, preserves one response contract.
- **Alternatives considered:** full websocket payload streaming; polling-only tuning.
- **Why chosen:** best reliability-to-complexity balance for live dashboard behavior.
- **Consequences:** introduces websocket lifecycle/reconnect logic and targeted backend stream loop.
- **Follow-ups:** can later extend to request-log invalidation if needed.

## Execution Handoff (ralph/team)

### Available agent types roster

- `executor`
- `architect`
- `test-engineer`
- `verifier`
- `writer`

### Follow-up staffing guidance

- **$ralph path (single owner):**
  1. executor (backend websocket + sanitizer)
  2. executor (frontend hook + integration)
  3. test-engineer (targeted tests)
  4. verifier (evidence + regression lock checks)

- **$team path (parallel lanes):**
  - Lane A (`executor`, reasoning high): backend websocket endpoint + auth validator extraction.
  - Lane B (`executor`, reasoning medium/high): frontend websocket hook + query invalidation/fallback polling.
  - Lane C (`test-engineer`, reasoning medium): sanitizer + websocket behavior test suite updates.
  - Final gate (`verifier`, reasoning high): prove acceptance criteria + no cascade regressions.

### Launch hints

- Ralph:

    $ralph implement dashboard-live-usage-websocket using openspec/plan/dashboard-live-usage-websocket/planner/plan.md

- Team:

    $team implement dashboard-live-usage-websocket using openspec/plan/dashboard-live-usage-websocket/planner/plan.md

### Team verification path

1. Backend websocket endpoint auth and invalidation semantics pass.
2. Frontend refetch-on-event and fallback polling tests pass.
3. Sanitizer regressions for wrapper stripping pass.
4. `openspec validate --specs` passes.

## Revision Note

- 2026-04-08 12:47Z: Initial execution-ready plan drafted for websocket invalidation + live_usage/task-preview cleanup.
