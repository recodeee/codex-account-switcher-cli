# Codebase Review: Improvement Ideas

_Date: 2026-04-04_

## Snapshot (what I reviewed)

- Repo scale: **1329 tracked files**, including Python backend, React frontend, and auxiliary CLIs/apps.
- Backend size: **247 Python files / ~40.6k LOC** under `app/`.
- Frontend size: **233 TS/TSX files / ~29.6k LOC** under `frontend/src/`.
- Test footprint: **~52.9k LOC** under `tests/` (strong investment in tests).
- OpenSpec state: **76 active changes** in `openspec/changes/`.

## Biggest opportunities (prioritized)

## P0 — High impact, should do first

### 1) Split proxy hot-path monolith into smaller services

**Why:** `app/modules/proxy/service.py` is ~236KB with multiple 200–500 line methods (`_stream_with_retry`, `_get_or_create_http_bridge_session`, `compact_responses`, etc.). This increases regression risk and slows feature delivery.

**Suggested direction:**

- Extract dedicated modules for:
  - account selection/retry policy,
  - HTTP bridge session lifecycle,
  - websocket relay/event mapping,
  - rate-limit and error envelope translation.
- Keep a thin orchestration layer in `ProxyService`.
- Add contract tests around extracted boundaries before moving logic.

---

### 2) Reduce broad `except Exception` usage in critical runtime paths

**Why:** there are **100 `except Exception`** catches in `app/`, including startup (`app/main.py`) and proxy clients. Some are valid resilience boundaries, but many hide root-cause specificity.

**Suggested direction:**

- Keep broad catches only at process/API boundaries.
- Replace internal broad catches with typed exceptions (`aiohttp`, parsing, DB, timeout, validation).
- Standardize structured error metadata (`reason_code`, `layer`, `retryable`) for observability.

---

### 3) Break `lifespan` orchestration into startup/shutdown components

**Why:** `app/main.py` `lifespan()` handles many concerns at once (DB, HTTP, schedulers, metrics server, ring registration, cache invalidation, shutdown drains).

**Suggested direction:**

- Introduce a startup orchestration module with explicit phases and rollback/cleanup hooks.
- Add health/ready state checks per phase.
- Keep `main.py` as wiring only.

## P1 — Medium impact, strong maintainability gains

### 4) Group settings by domain instead of one large settings class

**Why:** `app/core/config/settings.py` currently centralizes many unrelated knobs.

**Suggested direction:**

- Split into nested config models (`DatabaseSettings`, `ProxySettings`, `FirewallSettings`, `ObservabilitySettings`, etc.).
- Keep env var compatibility through aliases.
- Add schema docs/tests to catch invalid combinations early.

---

### 5) Frontend bundle and page-load optimization via route-level lazy loading

**Why:** `frontend/src/App.tsx` imports all pages eagerly, including heavy dashboard/session components.

**Suggested direction:**

- Use `React.lazy` + `Suspense` for route components.
- Preload critical routes only (`/dashboard`), lazy-load secondary pages (`/sessions`, `/settings`, etc.).
- Track bundle size budget per PR.

---

### 6) Decompose large UI components + move shaping logic into selectors/hooks

**Why:** large components such as `account-card.tsx` and `sessions-page.tsx` mix data shaping and rendering, making tests and refactors harder.

**Suggested direction:**

- Move row/summary computation into pure selector utilities (unit tested).
- Keep components mostly presentational.
- Standardize per-feature folder pattern: `api/`, `selectors/`, `hooks/`, `components/`.

---

### 7) CI runtime optimization and deduplication

**Why:** `.github/workflows/ci.yml` repeats Bun install/build steps across many jobs, increasing CI wall time and maintenance burden.

**Suggested direction:**

- Use matrix jobs and/or reusable workflows/composite actions.
- Cache Bun dependencies aggressively and share built frontend artifacts across jobs.
- Keep full test matrix, but reduce duplicated setup.

## P2 — Strategic/process improvements

### 8) OpenSpec backlog hygiene

**Why:** 76 active change folders suggests review/archival debt.

**Suggested direction:**

- Weekly triage: archive completed, close stale, mark blocked.
- Add lightweight status metadata (`active`, `blocked`, `stale`, `ready-for-archive`).
- Keep active queue short to improve planning signal.

---

### 9) Multi-project workspace governance

**Why:** repo contains multiple runtimes/projects (`frontend`, `codex-auth`, `codex-account-switcher`, `CodexBar`) with separate toolchains.

**Suggested direction:**

- Define explicit workspace governance (ownership, release boundaries, shared lint/test rules).
- Consider a top-level workspace manifest for Node subprojects where practical.

## Suggested execution plan (4 sprints)

1. **Sprint 1:** Proxy service decomposition phase 1 + exception taxonomy baseline.
2. **Sprint 2:** Lifespan orchestration split + settings model grouping.
3. **Sprint 3:** Frontend route lazy loading + large-component selector extraction.
4. **Sprint 4:** CI dedupe + OpenSpec backlog cleanup policy rollout.

## Quick wins this week

- Add typed exception wrappers in top 10 hottest `except Exception` sites.
- Extract one proxy subdomain (`HTTP bridge session manager`) from `ProxyService`.
- Lazy-load `/sessions` and `/settings` pages.
- Add OpenSpec triage script/report for active changes.
