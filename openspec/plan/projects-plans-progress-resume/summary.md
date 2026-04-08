# Plan Summary: projects-plans-progress-resume

- **Mode:** ralplan
- **Status:** approved
- **Task:** Improve `/projects/plans` so it clearly shows role coverage (including Designer), resume point (where work left off), and an overall progress percentage bar.

## Context

The current Plans page already lists plan roles and renders raw checkpoint markdown, but it does not expose a structured “left off here” signal and does not show aggregate completion percent. Backend role order also omits `designer`, so UI cannot consistently display it.

## RALPLAN-DR Snapshot

### Principles

1. Prefer backend-authored progress facts over frontend markdown parsing.
2. Keep role rendering deterministic across all plan workspaces.
3. Make progress understandable at a glance (percent + active checkpoint).
4. Preserve existing API behavior for consumers while adding typed fields.

### Decision Drivers (Top 3)

1. User clarity: show exactly where planning/execution currently stands.
2. Contract safety: typed API additions with stable defaults.
3. Low-risk delivery: additive schema changes with focused integration tests.

### Viable Options

- **Option A (chosen):** Extend plans backend service to compute structured progress + current checkpoint, expose via API, and render in frontend.
  - Pros: single source of truth, simpler frontend, consistent behavior across plans.
  - Cons: touches backend schemas + tests + frontend contracts.
- **Option B:** Keep backend unchanged; parse markdown in frontend for active checkpoint and percent.
  - Pros: faster local UI iteration.
  - Cons: brittle parsing duplication, inconsistent if markdown format drifts.
- **Option C:** Only add a frontend progress bar from existing role counts; skip resume checkpoint pointer.
  - Pros: minimal scope.
  - Cons: misses the core ask (where plan left off).

**Why A:** It satisfies all requested behaviors with the best long-term reliability.

## Architect Review (A1)

- **Steelman antithesis:** Do everything in frontend parsing so backend remains read-only file passthrough.
- **Tradeoff tension:** Speed of UI-only delivery vs maintainability/consistency of shared progress semantics.
- **Synthesis:** Compute progress and active checkpoint in backend once; keep frontend purely presentational.

## Critic Verdict (C1)

**APPROVE** — The plan has clear acceptance criteria, bounded file touchpoints, explicit verification, and additive risk profile.

## ADR

### Decision

Add backend-computed `overallProgress` + `currentCheckpoint` fields to plans detail/summary responses, include `designer` in canonical role order, and render progress bar + “left off” panel in the Plans page.

### Alternatives considered

- Frontend-only markdown parsing (rejected: brittle, duplicated logic).
- Progress-only without checkpoint resume (rejected: incomplete vs user request).

### Consequences

- API contracts for plans responses expand (backend + frontend schema updates required).
- Existing consumers remain compatible if fields are additive and optional-safe.
- Integration tests must assert new progress/resume behavior.

### Follow-ups

1. Optionally add filters/sorting by progress percent.
2. Add richer per-role checkpoint timelines if requested.

## Acceptance Criteria

1. Plans APIs include `designer` in role ordering output when role data is available, and return stable empty/default progress entries when missing.
2. Plans API responses include aggregate completion percentage (`0-100`) based on total/done checkpoints across roles.
3. Plans API responses include structured current checkpoint pointer with role/id/state/message/timestamp resolved from checkpoint log.
4. Frontend `/projects/plans` renders:
   - progress bar + percentage label,
   - “left off at” checkpoint card (or clear fallback when none),
   - role cards including Designer when returned by API.
5. Existing summary/checkpoint markdown rendering remains intact.

## Verification Plan

### Backend

- `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_plans_api.py`

### Frontend

- `cd apps/frontend && bun run test -- --run src/__integration__/plans-flow.test.tsx` *(or add the test file if absent)*
- `cd apps/frontend && bun run lint src/features/plans/components/plans-page.tsx src/features/plans/schemas.ts`

### OpenSpec

- `openspec validate --specs`

## File-level Implementation Steps

1. **Backend service parsing** — `app/modules/plans/service.py`
   - extend canonical role order with `designer`.
   - add checkpoint-log parser for structured current checkpoint resolution.
   - compute aggregate progress metrics.
2. **Backend response models** — `app/modules/plans/schemas.py`, `app/modules/plans/api.py`
   - add typed fields for `overall_progress` and `current_checkpoint` in summary/detail shapes.
3. **Backend integration coverage** — `tests/integration/test_plans_api.py`
   - assert designer role visibility, progress percentage, and current-checkpoint mapping.
4. **Frontend contract + UI** — `apps/frontend/src/features/plans/schemas.ts`, `apps/frontend/src/features/plans/components/plans-page.tsx`
   - consume new fields and render progress/resume visuals.
5. **Frontend test coverage** — `apps/frontend/src/__integration__/plans-flow.test.tsx` (+ MSW handler updates as needed)
   - verify progress bar percent and resume checkpoint rendering.

## Risks and Mitigations

- **Risk:** Markdown checkpoint format variance breaks parser.
  - **Mitigation:** tolerant regex + fallback to null checkpoint.
- **Risk:** Missing designer folder in older plan workspaces.
  - **Mitigation:** additive role-default handling and non-failing UI fallbacks.
- **Risk:** Percent mismatch confusion (checkpoint-only vs all tasks).
  - **Mitigation:** document and enforce “checkpoint-section based” definition in tests.

## Available-agent-types roster

- `executor`: backend/frontend implementation
- `test-engineer`: integration/MSW coverage
- `verifier`: evidence and acceptance checks
- `writer`: OpenSpec/task docs sync

## Staffing guidance

### Ralph lane (sequential)
- `executor` -> `test-engineer` -> `verifier`

### Team lane (parallel)
- Worker A: backend service + API schema
- Worker B: frontend schema + Plans UI
- Worker C: backend/frontend tests + OpenSpec validation

Launch hint: `$team "implement projects-plans-progress-resume"`
