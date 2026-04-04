# Next.js + Bun + TanStack Router Migration Task Pack

Owner handoff document for parallel Codex execution.

## 0) Scope + constraints

- Replace current Vite frontend with a Next.js frontend (Bun runtime/tooling).
- Keep FastAPI backend as source of truth on `:2455`.
- Preserve all existing product behavior (Dashboard, Accounts, APIs, Devices, Sessions, Settings, auth).
- Keep TanStack Router as the app-level route/state system for main UI flows.
- Maintain local-dev hot reload without requiring `redeploy.sh`.

---

## 1) Foundation & architecture decisions

- [ ] 1.1 Create OpenSpec change artifacts (`proposal.md`, `specs/*/spec.md`) for the migration scope.
- [ ] 1.2 Decide target structure:
  - Option A: Replace `frontend/` with Next app.
  - Option B: Create `web/` Next app, keep old `frontend/` temporarily for phased cutover.
- [ ] 1.3 Define routing model:
  - Next handles server shell + assets.
  - TanStack Router handles in-app navigation within a catch-all client entry.
- [ ] 1.4 Define backend proxy rules for `api`, `v1`, `backend-api`, `health`, and websocket terminal path(s).

---

## 2) Next.js app bootstrap (Bun)

- [ ] 2.1 Scaffold Next.js app with Bun lockfile and scripts.
- [ ] 2.2 Configure TypeScript path aliases (`@/*`) and strict settings.
- [ ] 2.3 Install and wire required dependencies:
  - `@tanstack/react-router`
  - `@tanstack/react-query`
  - existing UI stack (radix-ui, zod, sonner, recharts, etc.)
- [ ] 2.4 Port theme/bootstrap providers currently used by `App` root.

---

## 3) TanStack Router integration inside Next

- [ ] 3.1 Add client-side app entry (`"use client"`) hosting TanStack Router provider.
- [ ] 3.2 Define typed route tree equivalent to current pages:
  - `/dashboard`, `/accounts`, `/apis`, `/devices`, `/sessions`, `/settings`, `/storage`
- [ ] 3.3 Port search-param behavior currently used for filters/pagination.
- [ ] 3.4 Ensure direct URL entry and refresh work for all app routes.

---

## 4) API client + transport compatibility

- [ ] 4.1 Port `api-client` utilities and shared schemas.
- [ ] 4.2 Add Next rewrite/proxy config to FastAPI target (`http://server:2455` in Docker, localhost in local dev).
- [ ] 4.3 Validate websocket compatibility for terminal/session features.
- [ ] 4.4 Preserve unauthorized/session-expired behavior and global error UX.

---

## 5) Feature migration (module-by-module)

- [ ] 5.1 Dashboard feature parity (cards, working-now grouping, request logs, donuts, refresh behavior).
- [ ] 5.2 Accounts feature parity (switch/use local, re-auth, snapshot repair dialogs).
- [ ] 5.3 APIs feature parity (API keys, limits, model rules).
- [ ] 5.4 Devices feature parity.
- [ ] 5.5 Sessions feature parity.
- [ ] 5.6 Settings + sticky sessions + firewall feature parity.
- [ ] 5.7 Terminal modal/popout parity.

---

## 6) Styling/assets build pipeline

- [ ] 6.1 Port Tailwind setup to Next (`postcss/tailwind` as needed).
- [ ] 6.2 Port global styles, fonts, tokens, and animation classes.
- [ ] 6.3 Ensure static assets resolve correctly (icons, version asset, chart colors, etc.).

---

## 7) Docker/dev workflow (no redeploy loop)

- [ ] 7.1 Update `docker-compose.yml`:
  - Next dev service with bind mount + Bun install cache volume.
  - FastAPI service unchanged except required env/proxy tweaks.
- [ ] 7.2 Ensure live edits are visible immediately:
  - Next HMR on frontend edits.
  - FastAPI auto-reload on backend edits.
- [ ] 7.3 Remove obsolete Vite-specific watch/build steps once cutover is complete.

---

## 8) Test migration + verification

- [ ] 8.1 Port/replace existing frontend unit + integration tests to run against Next app entry.
- [ ] 8.2 Keep critical regression coverage:
  - working-now classification
  - dashboard loading/error states
  - re-auth routing flow
  - account switch/use-local flow
- [ ] 8.3 Run frontend checks:
  - lint
  - typecheck
  - tests
- [ ] 8.4 Run backend unit tests impacted by frontend contract assumptions.
- [ ] 8.5 Run `openspec validate --specs`.

---

## 9) Cutover & cleanup

- [ ] 9.1 Switch default served frontend to Next output/dev server path.
- [ ] 9.2 Remove Vite-only code/config once parity is proven.
- [ ] 9.3 Update README development commands for Next + Bun.
- [ ] 9.4 Add migration notes (what changed, rollback plan, known gaps).

---

## 10) Acceptance criteria (must all pass)

- [ ] 10.1 Opening a new tab shows Dashboard values and working-now grouping without hanging.
- [ ] 10.2 Frontend edits appear live without `redeploy.sh`.
- [ ] 10.3 All existing routes/features function with same or better UX.
- [ ] 10.4 No critical regressions in auth, account switching, sessions, or API proxy behavior.
- [ ] 10.5 CI/local checks pass and OpenSpec artifacts are valid.
