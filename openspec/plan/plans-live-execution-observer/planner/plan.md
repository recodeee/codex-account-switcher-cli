# ExecPlan: plans-live-execution-observer

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Follow repository guidance in `openspec/plan/PLANS.md`.

## Purpose / Big Picture

After this plan ships, `/projects/plans` will not only show static OpenSpec files; it will also show a live planning observer for the selected plan (active phase, session lifecycle, spawned agent roster with model names, and a timeline of waiting/finished/completed statuses). Operators can monitor planning from the dashboard instead of switching to CLI panes, and if a lane/account errors, OMX will persist the last known checkpoint + error so the next run can continue from a deterministic resume point.

## Progress

- [x] (2026-04-08 10:13Z) Captured user intent and current technical baseline for plans page + OMX state/log touchpoints.
- [x] (2026-04-08 10:13Z) Drafted initial RALPLAN-DR principles/drivers/options and selected a backend-observer contract approach.
- [x] (2026-04-08 10:18Z) Architect review completed; fail-closed telemetry and correlation guardrails integrated.
- [x] (2026-04-08 10:20Z) Critic rejected draft due missing producer/writer contract; revised and resolved blockers.
- [x] (2026-04-08 10:22Z) Full architect->critic loop closed with APPROVE-ready handoff.
- [x] (2026-04-08 12:54Z) Added resume-state contract for account/runtime failures: persist last checkpoint + error envelope and expose resumable payload in runtime API.
- [x] (2026-04-08 19:31Z) Implemented backend runtime endpoint and parsing/correlation path (`/api/projects/plans/{slug}/runtime`) with fail-closed unavailable reasons.
- [x] (2026-04-08 19:33Z) Implemented frontend live observer panel (session metadata, lanes, timeline, resume state) and adaptive polling.
- [x] (2026-04-08 19:35Z) Completed verification bundle: backend integration tests, frontend plans tests, lint/typecheck, and OpenSpec change/spec validation.

## Surprises & Discoveries

- Observation: existing plans backend only reads `openspec/plan/<slug>` markdown artifacts and has no runtime observer contract.
  Evidence: `app/modules/plans/service.py` currently returns summary/checkpoints/roles only.
- Observation: OMX runtime state is local and already session-scoped (`.omx/state/sessions/<session_id>/ralplan-state.json`), which can anchor active/completed phase visibility.
  Evidence: state files under `.omx/state/sessions/**` include `active`, `current_phase`, `updated_at`, `completed_at`.
- Observation: currently available `.omx/logs/*.jsonl` are useful for session start/end but not guaranteed to provide structured per-agent spawn/model/status events.
  Evidence: `.omx/logs/omx-*.jsonl` contains `session_start`/`session_end`; event schema lacks explicit agent roster fields.
- Observation: runtime/account limit failures can happen between checkpoints, so relying only on live state loses the exact failure boundary after restart.
  Evidence: captured session transcript includes usage-limit termination immediately after critic wait, requiring continuation from the last successful checkpoint.

## Decision Log

- Decision: choose dedicated backend runtime-observer payload (Option A), with graceful fallback when structured events are unavailable.
  Rationale: user explicitly needs spawned model/status visibility; frontend-only text scraping is too brittle.
  Date/Author: 2026-04-08 / planner

- Decision: keep existing plan detail API stable and add runtime observer as an additive contract (separate endpoint).
  Rationale: minimizes regression risk for already-working summary/checkpoints rendering.
  Date/Author: 2026-04-08 / planner

- Decision: persist a session-scoped resume state file that always tracks `lastCheckpoint` and `lastError` for the plan.
  Rationale: enables deterministic recovery when an account/runtime lane fails or hits limits mid-flow.
  Date/Author: 2026-04-08 / planner

## Outcomes & Retrospective

Architect and critic concerns converged on one core point: this feature is only safe if runtime telemetry contracts are explicit and authoritative. The revised plan now gates live roster/timeline rendering on producer-owned structured events and keeps static plan content unaffected when runtime data is unavailable.

## Context and Orientation

Current implementation:

- Frontend: `apps/frontend/src/features/plans/components/plans-page.tsx`
  - Renders plan list + static detail cards.
- Frontend data hook: `apps/frontend/src/features/plans/hooks/use-open-spec-plans.ts`
- Frontend API/schemas: `apps/frontend/src/features/plans/api.ts`, `apps/frontend/src/features/plans/schemas.ts`
- Backend API: `app/modules/plans/api.py`
- Backend service: `app/modules/plans/service.py`
- Backend schemas: `app/modules/plans/schemas.py`
- Existing backend tests: `tests/integration/test_plans_api.py`

Runtime data candidates:

- `.omx/state/sessions/<session_id>/ralplan-state.json`
- `.omx/state/sessions/<session_id>/skill-active-state.json`
- `.omx/logs/omx-*.jsonl` (session lifecycle)
- optional structured telemetry file proposed by this plan:
  - `.omx/state/sessions/<session_id>/ralplan-agent-events.jsonl`

## Plan of Work

Phase 0 (telemetry producer contract — prerequisite):
- Define producer owner: OMX runtime orchestration layer (session-mode lifecycle hook) is responsible for writing plan-runtime telemetry.
- Define required artifacts:
  - `openspec/plan/<slug>/.omx-session.json` (plan↔session binding)
  - `.omx/state/sessions/<session_id>/ralplan-agent-events.jsonl` (agent/model/status timeline)
  - `.omx/state/sessions/<session_id>/ralplan-resume-state.json` (last checkpoint + last error envelope)
- Define required event schema (mandatory keys):
  - `ts`, `eventType`, `sessionId`, `source`, `authoritative`, `agentName`, `role`, `model`, `status`, `message`
- Define required resume state schema (mandatory keys):
  - `planSlug`, `sessionId`, `lastCheckpoint`, `lastError`, `resumable`, `updatedAt`
- Define retention bounds:
  - producer keeps last 500 events per session file
  - consumer returns max 200 newest events per API response

Phase 1 (contract and observer plumbing):
- Create a new plans-runtime service in backend that resolves the selected plan to an OMX session candidate and returns runtime observer payload.
- Add endpoint `GET /api/projects/plans/{plan_slug}/runtime`.
- Return fail-closed payload when runtime data is missing (`available=false`, reason code), never 500 for normal missing telemetry.

Phase 2 (data sources and parsing):
- Implement state-file reader for phase/active/completion.
- Implement resume-state reader for `ralplan-resume-state.json`.
- Implement lifecycle extraction from `.omx/logs/omx-*.jsonl`.
- Implement agent-event parsing:
  - authoritative source only: structured `ralplan-agent-events.jsonl` if present;
  - if missing: return runtime payload with `available=false` for agent roster/timeline and explicit reason code (no regex fallback for authoritative telemetry).
- Normalize to typed events and dedupe by timestamp+signature.
- Merge resume state into runtime payload and mark `partial=true` when event feed is missing but resume state exists.

Phase 3 (frontend live observer UX):
- Add runtime query hook with adaptive polling:
  - active session: 5s
  - inactive/no runtime: 30s or disabled after one fetch
- Add “Live plan observer” card on plan detail:
  - session id, mode/phase/status badges
  - active spawned lanes (agent nickname, role, model, status)
  - timeline list (most recent first) with status color coding
  - resume block (last checkpoint + last error + can resume indicator)
  - telemetry fallback message when unavailable

Phase 4 (tests/verification):
- Backend integration tests for:
  - runtime endpoint success with fixture files
  - missing runtime data fallback
  - account/runtime error resume-state payload
  - malformed JSON resilience
- Frontend tests for:
  - live observer rendering states (loading/active/inactive/unavailable)
  - timeline entries and model badges
  - resume state rendering (`last checkpoint`, `error`, `can continue`)
  - polling behavior transitions

## Concrete Steps

Run from repository root:

    cd /home/deadpool/Documents/codex-lb

1) Align OpenSpec change scope before implementation

    openspec new change add-plans-live-execution-observer
    # add proposal/tasks/spec deltas for plans runtime observer behavior

2) Backend runtime observer contract + service

    .venv/bin/python -m pytest tests/integration/test_plans_api.py -q

3) Frontend observer rendering + hook wiring

    bun test --run ./apps/frontend/src/features/plans/components/plans-page.test.tsx

4) Focused cross-surface verification

    bun test --run ./apps/frontend/src/__integration__/plans-flow.test.tsx
    openspec validate --specs

5) Deterministic runtime-observer fixtures (required)

    # backend fixtures: producer-present, producer-absent, correlation tie, unresolved mapping
    .venv/bin/python -m pytest tests/integration/test_plans_api.py -k "runtime"

    # frontend fixtures: live observer active/inactive/unavailable states and event rendering
    bun test --run ./apps/frontend/src/features/plans/components/plans-page.test.tsx

## Validation and Acceptance

Acceptance criteria:

- Plans detail shows a runtime observer panel for a selected plan.
- When planning is active, panel updates live and shows:
  - current phase/status
  - spawned agents with role + model
  - timeline events for spawned/waiting/finished/completed states.
- When a runtime/account lane errors, panel still shows persisted `lastCheckpoint` and `lastError`, and surfaces resume guidance.
- When runtime telemetry is missing, panel clearly shows “runtime data unavailable” without breaking static summary/checkpoints.
- Correlation edge-cases are deterministic:
  - tie case returns `correlationConfidence=\"low\"` + `partial=true`
  - unresolved mapping returns `correlation_unresolved` reason and no roster/timeline.
- Existing list/detail plan behavior remains intact.

Evidence required:

- backend integration tests green
- frontend plans component/integration tests green
- OpenSpec spec validation green

## Idempotence and Recovery

- Runtime observer endpoint is read-only; safe to retry.
- If structured event stream is absent, fallback mode still preserves existing UX.
- If parsing fails for one source, endpoint returns partial observer data + reason code instead of failing whole request.
- Resume state writes are idempotent upserts keyed by `sessionId + planSlug`; retries must never erase an existing `lastCheckpoint` unless a newer checkpoint exists.

## Plan↔Session Correlation Contract

Deterministic correlation order for `plan_slug -> session_id`:

0. OMX runtime producer writes and maintains `openspec/plan/<slug>/.omx-session.json` at ralplan start/update/complete.
1. `openspec/plan/<slug>/.omx-session.json` explicit mapping (authoritative).
2. Most recent active `.omx/state/sessions/*/ralplan-state.json` whose `task_description` or tracked metadata references `<slug>`.
3. Most recent `.omx/state/sessions/*/ralplan-resume-state.json` with matching `planSlug` and non-null `lastCheckpoint`.
4. Most recent completed ralplan session whose `updated_at` is within bounded window of plan workspace `updated_at`.
5. If multiple candidates still tie, choose newest `updated_at` and set `correlationConfidence="low"` + `partial=true`.
6. If no candidate passes rules, return `correlation_unresolved` and keep static plan detail UI.

## Artifacts and Notes

- Context snapshot: `.omx/context/plans-live-execution-observer-20260408T101328Z.md`
- Existing plan UX baseline: `apps/frontend/src/features/plans/components/plans-page.tsx`
- Existing backend read path: `app/modules/plans/service.py`

## Interfaces and Dependencies

Proposed backend contract (new):

- `GET /api/projects/plans/{plan_slug}/runtime`
  - Response fields (draft):
    - `available: boolean`
    - `sessionId: string | null`
    - `correlationConfidence: "high" | "medium" | "low" | null`
    - `mode: "ralplan" | "ralph" | ... | null`
    - `phase: string | null`
    - `active: boolean`
    - `updatedAt: datetime | null`
    - `agents: Array<{name, role, model, status, startedAt?, updatedAt?, source, authoritative}>`
    - `events: Array<{ts, kind, message, agentName?, role?, model?, status?, source, authoritative}>`
    - `lastCheckpoint: {timestamp, role, checkpointId, state, message} | null`
    - `lastError: {timestamp, code, message, source, recoverable} | null`
    - `canResume: boolean`
    - `partial: boolean`
    - `staleAfterSeconds?: number`
    - `reasons: string[]`
    - `unavailableReason?: string`

Proposed frontend additions:

- `listOpenSpecPlans` (existing) unchanged.
- new `getOpenSpecPlanRuntime(slug)` in `features/plans/api.ts`.
- new hook `useOpenSpecPlanRuntime` with adaptive polling.

## Revision Note

- 2026-04-08 10:13Z: Initial planner draft created for live execution observer scope.
- 2026-04-08 10:20Z: Added telemetry producer contract, plan-session writer contract, deterministic edge-case tests, and reason-code taxonomy.
- 2026-04-08 10:22Z: Consensus pass finalized for execution handoff.
- 2026-04-08 12:54Z: Added persistent resume contract for account/runtime errors (`lastCheckpoint` + `lastError`) and correlation fallback via resume-state files.

## ADR (Decision Record)

- **Decision:** Add a dedicated plan-runtime observer contract (`/api/projects/plans/{slug}/runtime`) with authoritative structured telemetry requirements.
- **Drivers:** user needs live spawned-model/status visibility; reliability > heuristic text parsing; preserve existing plans UX.
- **Alternatives considered:** frontend-only text scraping; phase-only observer without roster/timeline.
- **Why chosen:** additive backend contract is testable, fail-closed, and extensible.
- **Consequences:** requires OMX runtime producer support for structured events and plan-session binding metadata.
- **Consequences:** requires OMX runtime producer support for structured events, plan-session binding metadata, and resume-state upserts on checkpoint/error transitions.
- **Follow-ups:** codify producer write path ownership and ship initial runtime observer vertical slice.

## Execution Handoff (ralph/team)

### Available agent types roster

- `executor`
- `architect`
- `test-engineer`
- `verifier`
- `writer` (optional for spec/context sync)

### Staffing guidance

- **ralph (sequential):** executor -> test-engineer -> verifier
- **team (parallel):**
  - Lane A: executor (backend runtime endpoint + parser + schemas)
  - Lane B: executor (frontend observer panel + hook + adaptive polling)
  - Lane C: test-engineer (backend fixtures + frontend state/timeline tests)
  - Final gate: verifier (acceptance/evidence sweep)

### Reasoning levels by lane

- Backend parser/contract lane: high
- Frontend observer lane: medium-high
- Test lane: medium
- Verification lane: high

### Launch hints

- Sequential: `$ralph implement plans-live-execution-observer`
- Parallel: `$team implement plans-live-execution-observer`

### Team verification path

1. Backend runtime endpoint tests (including producer-missing fallback and correlation edge cases) pass.
2. Frontend observer rendering/polling tests pass for active/inactive/unavailable states.
3. Existing plans list/detail tests remain green.
4. `openspec validate --specs` passes.
