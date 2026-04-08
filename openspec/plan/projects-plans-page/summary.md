# Plan Summary: projects-plans-page

- **Mode:** ralplan
- **Status:** completed
- **Task:** Create a Projects -> Plans page (`/projects/plans`) with visualized OpenSpec plan data.

## Context

This plan aligns the existing OpenSpec change `openspec/changes/add-projects-plans-visualization/` with a concrete implementation path spanning backend data APIs and frontend navigation/visualization. The goal is to make planning artifacts browsable in-app without leaving the dashboard.

## RALPLAN-DR Snapshot

### Principles

1. Deliver observable user value first (navigable page + useful plan data).
2. Keep OpenSpec artifacts and implementation in lockstep.
3. Prefer additive, test-anchored changes with clear rollback boundaries.
4. Keep API contracts explicit and typed across backend/frontend.

### Decision Drivers (Top 3)

1. Lowest-risk path to production-ready `/projects/plans` behavior.
2. Clear, testable acceptance criteria across API + UI.
3. Compatibility with existing nav architecture (`NAV_ITEMS` as source of truth).

### Viable Options

- **Option A (chosen):** Dedicated backend plans service + dedicated frontend Plans feature.
  - Pros: clear ownership, explicit contract, easiest to test end-to-end.
  - Cons: more files touched.
- **Option B:** Frontend reads `openspec/plan` files directly via static import/build-time approach.
  - Pros: less backend code.
  - Cons: brittle runtime behavior, poor auth/control, not suitable for live server state.
- **Option C:** Reuse Projects page and embed plans as a subpanel only.
  - Pros: fewer routes.
  - Cons: mixed concerns, weaker IA clarity, harder independent tests.

**Why A:** It best satisfies testability, explicit contracts, and future extension (filters/sorting/permissions).

## Execution Outcome (2026-04-08)

- Completed remaining execution roles (Executor, Writer, Verifier) and closed checkpoints `E1`, `W1`, `V1`.
- Hardened backend plan detail lookup to reject traversal slugs and keep reads scoped to `openspec/plan/<slug>`.
- Added integration regression coverage for encoded traversal attempts (`/api/projects/plans/%2E%2E`).
- Verification bundle passed:
  - `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_plans_api.py`
  - `cd apps/frontend && bun run test -- src/__integration__/plans-flow.test.tsx`
  - `cd apps/frontend && bun run test -- src/components/layout/account-menu.component.test.tsx src/components/layout/app-sidebar.test.tsx`
  - `.venv/bin/ruff check app/modules/plans/service.py tests/integration/test_plans_api.py`
  - `.venv/bin/ty check app/modules/plans/service.py`
  - `cd apps/frontend && bun run typecheck`
  - `openspec validate --specs`
