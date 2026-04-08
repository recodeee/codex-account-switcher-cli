## Why

Operators now store planning artifacts under `openspec/plan`, but the dashboard has no visual surface for those plans. Users requested a dedicated Plans menu nested under Projects so planning context can be reviewed without leaving the app.

## What Changes

- Add a frontend Plans route rendered as a submenu under Projects.
- Add backend dashboard APIs that read OpenSpec plan workspaces from `openspec/plan`.
- Show plan list + detail visualization (summary/checkpoint/role progress) in the frontend.
- Extend frontend mocks/integration tests and backend integration tests for the new route and APIs.

## Impact

- Code: `app/modules/plans/*`, `app/main.py`, `apps/frontend/src/components/layout/*`, `apps/frontend/src/features/plans/*`, `apps/frontend/src/App.tsx`
- Tests: `tests/integration/test_plans_api.py`, `apps/frontend/src/__integration__/plans-flow.test.tsx`, updated navigation/MSW coverage
- Specs: `openspec/specs/frontend-architecture/spec.md` (if route/menu requirements are expanded)
