## Why

Operators need a first-class place to group and manage work contexts. A navigation entry alone is not enough; the dashboard needs persisted project CRUD so teams can create, update, and remove project records directly from the UI.

## What Changes

- Add a top-level `Projects` route and active navigation item in the React dashboard.
- Add backend dashboard API endpoints for listing, creating, updating, and deleting projects.
- Persist projects in the database with validation and unique project names, including optional project path, sandbox mode, and git branch planner metadata.
- Add dashboard prompt-dispatch helpers so operators can inject project context (path/sandbox/branch) directly into Codex task prompts.
- Add frontend and backend tests covering project CRUD behavior and navigation flow.

## Impact

- Code: `app/modules/projects/*`, `app/dependencies.py`, `app/main.py`, `app/db/models.py`, `app/db/alembic/versions/*`, `apps/frontend/src/features/projects/*`, `apps/frontend/src/App.tsx`, `apps/frontend/src/components/layout/*`
- Tests: backend unit/integration tests + frontend integration/MSW coverage updates
- Specs: `openspec/specs/frontend-architecture/spec.md`
