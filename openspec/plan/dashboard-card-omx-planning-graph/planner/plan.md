# ExecPlan: dashboard-card-omx-planning-graph

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Follow repository guidance in `openspec/plan/PLANS.md`.

## Purpose / Big Picture

After completion, the dashboard account-card OMX planning presentation is governed by a durable, role-complete plan workspace that clearly separates RALPLAN graph behavior, non-RALPLAN Codex-active behavior, runtime-ready badge semantics, and verification evidence. A new contributor should be able to execute/verify the work by following this file and role task checklists only.

## Progress

- [x] (2026-04-09 15:38Z) Restored context from existing artifacts and confirmed this workspace was scaffold-only.
- [x] (2026-04-09 15:40Z) Completed planner role handoff with principles/drivers/options and acceptance framing.
- [x] (2026-04-09 15:42Z) Completed architect + critic quality pass and documented fail-closed constraints.
- [x] (2026-04-09 15:44Z) Ran focused verification bundle (tests/lint/typecheck/OpenSpec validate) and captured output.
- [x] (2026-04-09 15:45Z) Closed executor/writer/verifier checkpoints to DONE after evidence capture.

## Surprises & Discoveries

- Observation: Workspace files were generated templates with no role progress despite existing upstream `.omx` consensus artifacts.
  Evidence: `summary.md`, `checkpoints.md`, and all role `tasks.md` had scaffold placeholders and unchecked lists.
- Observation: Working tree already had unrelated local changes.
  Evidence: `git status --short --branch` showed `M apps/frontend/src/features/dashboard/components/account-card.tsx` and `?? examples/medusa/` before this task.

## Decision Log

- Decision: Resume from existing `.omx` context/plans and avoid re-planning from scratch.
  Rationale: Explicit user handoff says existing plan artifacts are source of truth.
  Date/Author: 2026-04-09 / planner

- Decision: Keep role checkpoints linear and explicit (P1→A1→C1→E1→W1→V1) with checklist-driven timeline updates.
  Rationale: Plans timeline UI reads checklist/checkpoint lines directly.
  Date/Author: 2026-04-09 / planner

- Decision: Keep runtime readiness semantics fail-closed and snapshot-validated.
  Rationale: Matches prior consensus and reduces false OMX-active signals.
  Date/Author: 2026-04-09 / architect

## Outcomes & Retrospective

Current verdict: **COMPLETE**.

Completed in this session:
- Planner/Architect/Critic role planning artifacts are aligned and checkpointed.
- Execution lanes are explicitly scoped (backend contract lane, frontend UX lane, evidence lane).

Completed closure:
- Final verification outputs recorded in `summary.md`.
- E1/W1/V1 checkpoints closed to DONE in `checkpoints.md` and role `tasks.md`.

## Context and Orientation

Primary planning inputs:
- `.omx/context/omx-dashboard-badge-multi-runtime-20260408T034907Z.md`
- `.omx/plans/ralplan-dashboard-card-agent-visibility-20260408.md`
- `.omx/plans/ralplan-test-plan-omx-dashboard-badge-multi-runtime.md`
- `.omx/notepad.md` (runtimeReady fail-closed consensus)

Likely execution touchpoints:
- Frontend card UX/tests:
  - `apps/frontend/src/features/dashboard/components/account-card.tsx`
  - `apps/frontend/src/features/dashboard/components/account-card.test.tsx`
  - `apps/frontend/src/features/dashboard/components/account-cards.test.tsx`
- Frontend contract schemas:
  - `apps/frontend/src/features/accounts/schemas.ts`
  - `apps/frontend/src/features/dashboard/schemas.ts`
- Backend codex auth contract:
  - `app/modules/accounts/codex_auth_status.py`
  - `app/modules/accounts/schemas.py`
  - `tests/unit/test_dashboard_codex_auth_mapping.py`
  - `tests/integration/test_accounts_api.py`
  - `tests/integration/test_dashboard_overview.py`

## Plan of Work

1. **Planner lane (complete):** Translate existing consensus into this OpenSpec plan workspace and establish acceptance criteria.
2. **Architecture/Critic lane (complete):** Validate ownership boundaries, fail-closed semantics, risk mitigations, and verification concreteness.
3. **Executor lane (complete):** Confirmed implementation alignment in touched backend/frontend files and verified expected behavior via focused tests.
4. **Writer lane (complete):** Synchronized summary/checkpoints/tasks wording with execution evidence.
5. **Verifier lane (complete):** Ran and recorded focused tests/lint/typecheck/OpenSpec validation; checkpoints closed after green evidence.

## Concrete Steps

Run from repo root unless noted:

    cd /home/deadpool/Documents/codex-lb

1) Verify workspace state and source artifacts.

    git status --short --branch
    sed -n '1,220p' openspec/plan/dashboard-card-omx-planning-graph/summary.md
    sed -n '1,260p' .omx/plans/ralplan-dashboard-card-agent-visibility-20260408.md

2) Focused backend verification for runtime-ready mapping.

    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/unit/test_dashboard_codex_auth_mapping.py -q

3) Focused backend integration verification for account/dashboard contract continuity.

    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_accounts_api.py -k silently_reactivates_workspace_account_after_team_rejoin -q
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_dashboard_overview.py -k silently_recovers_workspace_account_after_team_rejoin -q

4) Focused frontend verification for OMX planning graph and schemas.

    cd apps/frontend
    bun run test -- src/features/dashboard/components/account-card.test.tsx
    bun run test -- src/features/dashboard/components/account-cards.test.tsx
    bun run test -- src/features/accounts/schemas.test.ts src/features/dashboard/schemas.test.ts
    bun run lint -- src/features/dashboard/components/account-card.tsx src/features/dashboard/components/account-card.test.tsx src/features/accounts/schemas.ts src/features/dashboard/schemas.ts
    bun run typecheck
    cd ../..

5) OpenSpec consistency check.

    openspec validate --specs

## Validation and Acceptance

This plan can be marked complete when all of the following are true:

1. Role checklists are updated and accurate for all six roles.
2. Checkpoint timeline (`checkpoints.md`) reflects role progression and completion state.
3. Focused backend tests pass for runtime-ready semantics.
4. Focused frontend tests pass for OMX planning graph/card/schema behavior.
5. Lint/typecheck and OpenSpec validation complete without new errors.
6. Summary and plan narrative are synchronized with evidence and remaining risk is explicitly called out (if any).

## Idempotence and Recovery

- Re-running checkpoint updates is safe (checklist items are deterministic).
- If verification fails, keep checkpoints `IN_PROGRESS`, fix only scoped issues, then rerun failed commands.
- If unrelated pre-existing failures appear, record them explicitly and avoid claiming completion.
- Do not alter locked `account-working.ts` detection cascade without explicit request + regression tests.

## Artifacts and Notes

- Session context snapshot (this run): `.omx/context/dashboard-card-omx-planning-graph-20260409T153804Z.md`
- Prior scope snapshots:
  - `.omx/context/omx-dashboard-badge-multi-runtime-20260408T034907Z.md`
  - `.omx/context/dashboard-card-ralplan-agent-visibility-20260408T203312Z.md`
- Prior test-plan artifact:
  - `.omx/plans/ralplan-test-plan-omx-dashboard-badge-multi-runtime.md`

## Interfaces and Dependencies

- Backend JSON contracts: account/dashboard `codexAuth.runtimeReady` + `runtimeReadySource`.
- Frontend schema compatibility: `accounts/schemas.ts` and `dashboard/schemas.ts`.
- UI contract marker: planning graph `data-testid="omx-planning-prompt-graph"` behavior in account-card tests.
- Process constraints: OpenSpec-first flow, role task checklists for timeline rendering.

## Revision Note

- 2026-04-09 15:44Z: Replaced scaffold template with execution-ready plan narrative, role-lane sequencing, and focused verification bundle.
- 2026-04-09 15:46Z: Marked verification complete and closed remaining execution/docs/verifier checkpoints.
- 2026-04-09 15:50Z: Executed mandatory deslop pass (no-op) and re-ran focused regression bundle green.
