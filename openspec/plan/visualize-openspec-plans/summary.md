# Plan Summary: visualize-openspec-plans

**Status:** completed
**Overall progress:** 7/7 checkpoints complete (100%)
**Current checkpoint:** Verifier · V1 · DONE
**Current checkpoint note:** Frontend + backend + OpenSpec validation bundle passed
**Current checkpoint time:** 2026-04-08T13:48:43Z

## Goal
Add a **Plans** experience under **Projects** so operators can browse OpenSpec plan workspaces from the dashboard.

## Scope
- Frontend: add Projects -> Plans navigation and a Plans page.
- Backend: add read-only API to list plan workspaces and optional basic metadata from `openspec/plan`.
- Tests: frontend integration + mock coverage, backend integration/API contract tests.
- OpenSpec: add change artifacts before implementation.

## Out of scope
- Editing plan files from UI.
- Team-runtime checkpoint mutation from UI.
- Archive browsing under `openspec/changes/archive`.

## Proposed flow
1. User opens Projects > Plans.
2. Frontend calls backend plans endpoint.
3. Backend enumerates `openspec/plan/*` workspaces and returns normalized metadata.
4. Frontend renders plan list + quick status indicators + links to details view.

## Verification strategy
- Frontend integration test for nav and rendering path.
- MSW endpoint coverage includes new plans endpoint(s).
- Backend integration test validates response schema and filtering rules.

## Execution handoff guidance

### Recommended agent lanes
- **Backend lane (executor, high):** implement read-only plans API module + path allowlist + integration tests.
- **Frontend lane (executor, high):** add Projects submenu rendering + `/projects/plans` route + plans page.
- **Verification lane (verifier, high):** run targeted frontend integration tests, MSW coverage checks, backend integration tests, and OpenSpec validation.

### Suggested launch hints
- Sequential: `$ralph "implement openspec plans submenu feature from openspec/plan/visualize-openspec-plans"`
- Parallel: `$team "backend plans api | frontend plans route+submenu | verification"`

### Team verification path
1. Frontend: navigation + plans flow tests pass.
2. Frontend mocks: handler coverage includes new plans endpoint(s).
3. Backend: plans API integration tests pass (happy path + fail-closed path constraints).
4. OpenSpec: `openspec validate --specs` passes.
