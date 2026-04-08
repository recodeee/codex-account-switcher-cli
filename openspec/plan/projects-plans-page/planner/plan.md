# ExecPlan: projects-plans-page

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Follow repository guidance in `openspec/plan/PLANS.md`.

## Purpose / Big Picture

After this change, operators can open `/projects/plans` from the app navigation and inspect OpenSpec plan workspaces (summary, checkpoint status, and role details) without leaving the dashboard or opening files manually. Success is visible when a user clicks **Projects → Plans**, sees a list of plans, selects one, and observes role/task/checkpoint content loaded from backend APIs.

## Progress

- [x] (2026-04-08 09:44Z) Captured scope from existing change artifacts and repo touchpoints (`openspec/changes/add-projects-plans-visualization/*`, `app/modules/plans/*`, frontend nav/routes).
- [x] (2026-04-08 09:46Z) Drafted initial RALPLAN-DR principles/drivers/options and selected the dedicated API + feature route approach.
- [x] (2026-04-08 09:49Z) Integrated Architect review feedback (filesystem safety boundaries, explicit test creation, tighter contract notes).
- [x] (2026-04-08 09:53Z) Critic pass completed; plan marked APPROVE for execution handoff.
- [x] (2026-04-08 13:37Z) Completed executor pass with slug-boundary hardening in `OpenSpecPlansService` and new traversal regression coverage in `test_plans_api.py`.
- [x] (2026-04-08 13:37Z) Completed writer/verifier passes and closed all role checkpoints (`E1`, `W1`, `V1`) with fresh verification evidence.

## Surprises & Discoveries

- Observation: `omx explore` attempted spark model first and fell back to `gpt-5.4` due account model support limits.
  Evidence: CLI output included `gpt-5.3-codex-spark model is not supported ... Falling back to gpt-5.4`.
- Observation: backend plans module and frontend `/projects/plans` route stubs already exist in the working tree, so the plan should focus on completion/verification, not net-new discovery.
  Evidence: files present under `app/modules/plans/` and `apps/frontend/src/features/plans/` plus route/nav references in `App.tsx` and `nav-items.ts`.

## Decision Log

- Decision: Use Option A (dedicated backend plans service + dedicated frontend Plans feature) as the primary execution path.
  Rationale: Best testability and explicit API contract while preserving nav architecture and future extensibility.
  Date/Author: 2026-04-08 / planner

- Decision: Treat this as completion/hardening of an in-flight change (`add-projects-plans-visualization`) rather than starting a brand-new OpenSpec change.
  Rationale: Proposal/tasks already exist and map directly to the requested outcome.
  Date/Author: 2026-04-08 / planner

- Decision: Approve plan for execution after tightening acceptance criteria around slug/path safety and explicit integration-test creation.
  Rationale: Critic check passed once principles, options, risks, and verification steps were all concrete and testable.
  Date/Author: 2026-04-08 / critic

## Outcomes & Retrospective

Critic verdict: **APPROVE**.

Execution verdict: **COMPLETE**.

Implemented hardening and verification matched the approved plan:
- Backend now rejects malformed/traversal slugs before resolving plan paths.
- Integration coverage now validates encoded traversal rejection (`%2E%2E`) with deterministic `plan_not_found`.
- Focused backend/frontend tests, lint/typecheck, and `openspec validate --specs` all passed.

## Context and Orientation

This repository has two relevant halves:

1. Backend FastAPI service under `app/`.
   - `app/modules/plans/api.py` exposes plan list/detail endpoints.
   - `app/modules/plans/service.py` loads plan workspace files from `openspec/plan/<slug>/`.
   - `app/modules/plans/schemas.py` defines response shapes.
   - `app/main.py` includes the plans router.

2. Frontend app under `apps/frontend/src/`.
   - Navigation source of truth is `components/layout/nav-items.ts`.
   - Route wiring is in `App.tsx`.
   - Layout renderers (`app-sidebar.tsx`, `app-header.tsx`, `account-menu.tsx`) consume nav definitions.
   - Plans UI lives under `features/plans/` and must consume backend APIs.

Supporting verification:
- Backend integration tests: `tests/integration/test_plans_api.py`
- Frontend integration route flow: `apps/frontend/src/__integration__/plans-flow.test.tsx`
- OpenSpec change artifacts: `openspec/changes/add-projects-plans-visualization/{proposal.md,tasks.md}`

## Plan of Work

First, lock OpenSpec artifacts by aligning proposal/tasks language with final acceptance behavior and by ensuring this plan points to the same contract. Then finalize backend behavior for list/detail plans payloads (including graceful missing-file handling, slug/path boundary validation, and stable checkpoint progress extraction). Next, complete frontend route rendering for `/projects/plans` with list and detail states (loading, empty, error, success). Keep navigation consistent by driving all menu entries through `NAV_ITEMS` and route registration in `App.tsx`. Finally, complete integration coverage and run focused checks that prove the route is usable end to end.

## Architecture Review (Step 3)

### Steelman antithesis

A stronger minimal-risk alternative is to postpone a dedicated Plans feature and expose plans data only through an existing Projects detail surface. This reduces routing and navigation complexity, decreases API/UI contract surface area, and minimizes accidental divergence between plan metadata and layout behavior.

### Tradeoff tension

- **Clarity vs. surface area:** A dedicated `/projects/plans` page is clearer for users and future expansion, but it increases files/routes/tests to maintain.
- **Runtime filesystem flexibility vs. safety:** Reading `openspec/plan/*` at runtime is flexible, but it requires explicit safeguards to prevent path traversal and overly large markdown payload reads.

### Synthesis recommendation

Keep the dedicated page (Option A), but explicitly harden filesystem boundaries in the backend service and make test creation explicit in the frontend plan so the additional surface area remains controlled and verifiable.

### Blocking issues found

1. Filesystem safety constraints were implicit, not explicit.
2. Frontend integration test file (`plans-flow.test.tsx`) was referenced as if it already existed.

Both blockers are addressed below in Concrete Steps and Validation.

## Concrete Steps

Run from repository root:

    cd /home/deadpool/Documents/codex-lb

1) Confirm OpenSpec intent + tasks are current.

    sed -n '1,220p' openspec/changes/add-projects-plans-visualization/proposal.md
    sed -n '1,220p' openspec/changes/add-projects-plans-visualization/tasks.md

Expected: proposal explicitly states Projects -> Plans nav/page + API visualization scope; tasks map spec/tests/implementation.

2) Finalize backend plans API behavior and schemas, including slug/path boundary checks.

    .venv/bin/python -m pytest tests/integration/test_plans_api.py

Expected: tests cover list/detail success plus file/slug error handling and prove requests cannot escape `openspec/plan/`.

3) Finalize frontend route + visualization behavior and add missing integration test file if absent.

    bun test --run apps/frontend/src/__integration__/plans-flow.test.tsx

Expected: integration test proves navigation to `/projects/plans` and data rendering states.

4) Run focused frontend behavior tests around nav propagation if touched.

    bun test --run apps/frontend/src/components/layout/account-menu.component.test.tsx
    bun test --run apps/frontend/src/components/layout/app-sidebar.test.tsx

(If a listed test file does not exist, run the nearest existing layout/nav suite and record exact substitution.)

5) Validate OpenSpec specs remain valid.

    openspec validate --specs

Expected: all specs pass.

## Validation and Acceptance

Acceptance is met when all of the following are true:

- UI behavior:
  - User can navigate to `/projects/plans` from Projects navigation.
  - Plans list is visible with status/progress metadata.
  - Selecting a plan shows summary/checkpoints/role details.
  - Loading, empty, and error states are explicitly rendered and tested.

- API behavior:
  - `GET /api/projects/plans` returns stable list payload with progress fields.
  - `GET /api/projects/plans/{plan_slug}` returns summary/checkpoints/roles content.
  - Missing slug or malformed plan workspace returns deterministic, tested error responses.
  - Slug/path traversal attempts are rejected by tested backend safeguards.

- Evidence:
  - Backend integration tests pass.
  - Frontend integration tests pass.
  - OpenSpec validation passes.

## Idempotence and Recovery

All steps are safe to re-run. If a test fails after partial code changes, keep the branch state and iterate until the same command passes; do not reset unrelated local work. If API contract changes require frontend updates, bump schemas/hooks first and rerun integration tests before touching layout components. If OpenSpec docs drift from implementation, update change artifacts first, then rerun `openspec validate --specs`.

## Artifacts and Notes

Key references for implementation handoff:

- `openspec/changes/add-projects-plans-visualization/proposal.md`
- `openspec/changes/add-projects-plans-visualization/tasks.md`
- `.omx/context/create-projects-plans-page-20260408T094456Z.md`

Initial evidence snippet:

    omx explore found existing `/projects/plans` routing/nav references and backend plans module,
    indicating completion hardening + verification work rather than zero-to-one scaffolding.

## Interfaces and Dependencies

Backend contracts (must exist and remain stable):

- `app.modules.plans.api.router`
  - `GET /api/projects/plans`
  - `GET /api/projects/plans/{plan_slug}`
- `app.modules.plans.service.OpenSpecPlansService`
  - list and detail fetch methods consuming `openspec/plan/<slug>/` files
- `app.modules.plans.schemas`
  - typed list/detail response models used by API and frontend client

Frontend contracts (must exist and remain stable):

- Route registration in `apps/frontend/src/App.tsx` for `/projects/plans`
- Nav entry under Projects in `apps/frontend/src/components/layout/nav-items.ts`
- Plans page data-fetch hook + UI components under `apps/frontend/src/features/plans/`

Execution staffing guidance after approval:

- `executor` (high): backend API hardening + frontend feature completion
- `test-engineer` (medium): focused integration and regression additions
- `verifier` (high): final evidence run and acceptance cross-check

## Critic Review (Step 4)

Verdict: **APPROVE**

- Principle/option consistency: PASS
- Alternatives fairness + invalidation rationale: PASS
- Risk mitigation clarity (especially filesystem safety): PASS
- Acceptance criteria testability: PASS
- Verification commands concreteness: PASS

## ADR (Decision Record)

- **Decision:** Build and ship a dedicated `/projects/plans` page backed by explicit plans APIs.
- **Drivers:** clear user navigation, explicit contract testability, future extensibility for filtering/detail panes.
- **Alternatives considered:** embed inside existing Projects page only; frontend-only filesystem reads.
- **Why chosen:** dedicated API + page gives cleaner boundaries and safer runtime behavior.
- **Consequences:** more files/tests now, but lower long-term coupling and clearer ownership.
- **Follow-ups:** add pagination/filtering once base list/detail is stable and measured.

## Execution Handoff (ralph/team)

### Available agent types roster

- `executor`
- `test-engineer`
- `verifier`
- `writer` (optional for OpenSpec wording sync)

### Recommended staffing

- **ralph path (sequential):** executor -> test-engineer -> verifier
- **team path (parallel):**
  - Lane A: executor (backend plans module + API contract)
  - Lane B: executor (frontend route/nav + plans page UI)
  - Lane C: test-engineer (integration coverage + MSW/fixtures)
  - Final gate: verifier (cross-lane acceptance/evidence)

### Reasoning levels by lane

- Backend/API lane: high
- Frontend/layout lane: medium-high
- Test lane: medium
- Verification lane: high

### Launch hints

- Sequential execution: `$ralph implement openspec/changes/add-projects-plans-visualization`
- Parallel execution: `omx team "implement add-projects-plans-visualization"` or `$team implement add-projects-plans-visualization`

### Team verification path

1. Merge lane outputs into one branch.
2. Run backend integration: `.venv/bin/python -m pytest tests/integration/test_plans_api.py`
3. Run frontend integration: `bun test --run apps/frontend/src/__integration__/plans-flow.test.tsx`
4. Run nav regression: `bun test --run apps/frontend/src/components/layout/account-menu.component.test.tsx apps/frontend/src/components/layout/app-sidebar.test.tsx`
5. Run `openspec validate --specs`
6. Capture pass/fail evidence in `Outcomes & Retrospective`.

## Revision Note

- 2026-04-08 09:46Z: Initial ralplan draft created from existing OpenSpec change + codebase reconnaissance.
- 2026-04-08 09:49Z: Architect feedback integrated (explicit filesystem hardening + integration-test creation clarity).
- 2026-04-08 09:53Z: Critic approval recorded; handoff guidance for `ralph`/`team` finalized.
- 2026-04-08 13:37Z: Executor/Writer/Verifier checkpoints completed with verified implementation evidence.
