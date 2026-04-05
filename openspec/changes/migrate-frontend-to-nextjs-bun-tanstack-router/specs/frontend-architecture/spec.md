## MODIFIED Requirements
### Requirement: Vite project structure

The frontend SHALL be a standalone **Next.js App Router + React + TypeScript** project located at `frontend/` in the repository root. Build output SHALL still target `app/static/` so FastAPI can serve built assets without deployment topology changes.

#### Scenario: Development server

- **WHEN** the developer runs `bun run dev` in `frontend/`
- **THEN** the Next.js dev server starts with HMR on port `5173`
- **AND** `/api/*`, `/v1/*`, `/backend-api/*`, and `/health` requests are proxied to the FastAPI backend target.

#### Scenario: Production build

- **WHEN** the developer runs `bun run build` in `frontend/`
- **THEN** Next.js performs a static export
- **AND** exported assets are synchronized to `app/static/`.

### Requirement: SPA routing
The application SHALL expose App Router routes for `/dashboard`, `/accounts`, `/apis`, `/devices`, `/sessions`, `/settings`, and `/storage`. The root path `/` SHALL redirect to `/dashboard`. `/firewall` SHALL redirect to `/settings`.

#### Scenario: Direct navigation to route
- **WHEN** a user navigates directly to `/settings` in the browser
- **THEN** FastAPI resolves the route-specific exported `index.html` where available
- **AND** the Settings page renders.

#### Scenario: Route fallback
- **WHEN** an exported route folder is not present for a non-API path
- **THEN** FastAPI serves the root `index.html` as a fallback.
