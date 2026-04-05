## Why

The current frontend is tied to a Vite SPA bootstrap, which complicates route-level static exports and keeps tooling split between Vite-specific config and Bun workflows. We want a Next.js App Router foundation with Bun-first commands while preserving existing feature behavior and FastAPI API contracts.

## What Changes

- Replace the Vite app bootstrap with a Next.js App Router app in `frontend/`.
- Keep Bun as the package manager/runtime for install, dev, and build scripts.
- Keep existing feature pages (`/dashboard`, `/accounts`, `/apis`, `/devices`, `/sessions`, `/settings`, `/storage`) with route files under App Router.
- Export frontend assets to `app/static` for backend-served production bundles.
- Keep API proxy behavior for local dev (`/api`, `/v1`, `/backend-api`, `/health`).
- Update FastAPI SPA fallback to resolve nested `index.html` files for exported App Router paths.

## Impact

- Frontend development runs via Next.js dev server on port 5173.
- Production build continues to serve from `app/static`.
- Existing feature modules remain reusable with minimal routing adapter changes.
