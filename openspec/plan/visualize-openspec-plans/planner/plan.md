# planner precise plan list

## Objective
Deliver a full-stack, read-only OpenSpec Plans visualization in dashboard navigation as a Projects submenu.

## Principles
1. Full-stack closure over UI-only tweaks.
2. Read-only + fail-closed data access to filesystem-backed plans.
3. Keep nav semantics consistent across sidebar/header/account menu surfaces.
4. Make acceptance criteria testable at route, API, and rendering layers.

## Decision drivers (Top 3)
1. Safety of exposing filesystem-derived data in API.
2. UX consistency with existing Projects information architecture.
3. Fast, deterministic testability across frontend and backend.

## Viable options
### Option A — New top-level `/plans` route + backend `/api/plans`
- Pros: clean ownership and simple API contract.
- Cons: conflicts with user requirement of submenu under Projects.

### Option B — Nested `/projects/plans` route + backend `/api/projects/plans`
- Pros: directly matches user’s IA request; groups with Projects domain.
- Cons: slightly longer route chain and Projects module coupling.

### Option C — Frontend reads filesystem directly (no backend)
- Pros: fewer backend changes.
- Cons: breaks architecture/sandbox boundaries and test pattern.

## Chosen option
**Option B** (`/projects/plans` + `/api/projects/plans`) because it matches requested IA and preserves backend-mediated filesystem access.

## Execution phases
1. OpenSpec change artifacts (`openspec/changes/<slug>/proposal.md`, `tasks.md`).
2. Backend read-only plans endpoint + schema and integration tests.
3. Frontend feature module (`features/plans`) with route + Projects submenu wiring.
4. Frontend tests and MSW handler coverage updates.
5. Verification bundle + rollout notes.

## Notes
- Keep returned metadata minimal initially (slug, summary presence, updated timestamp, checkpoint count/status if available).
- Use explicit path allowlist rooted at repo `openspec/plan`.

## Architect review (consensus step)

### Steelman antithesis
A top-level Plans surface (`/plans`) with a domain-neutral backend (`/api/plans`) is architecturally cleaner than coupling plans into Projects endpoints. Plans are workspace process artifacts, not project entities.

### Tradeoff tension
- **IA fidelity**: nested under Projects matches user intent and discoverability.
- **Domain purity**: top-level plans APIs avoid long-term coupling to Projects module semantics.

### Synthesis recommendation
Keep the **UI nested under Projects** (`/projects/plans`) to satisfy requested information architecture, but keep backend read concerns isolated in a dedicated plans API module and service boundary so future extraction remains easy.

## Critic quality gate (consensus step)

### Verdict
APPROVE

### Required guardrails
1. Fail-closed filesystem allowlist rooted at `openspec/plan`.
2. Return only normalized metadata (no raw file content on list endpoint).
3. Include mock coverage parity updates in same PR as API route changes.
4. Explicitly test missing/invalid filesystem cases (empty directory, unreadable path).

## ADR (Decision Record)

- **Decision:** Implement `Projects -> Plans` UI route and submenu, backed by a read-only backend plans listing endpoint.
- **Drivers:** user-requested IA, backend security boundary, deterministic testability.
- **Alternatives considered:** top-level `/plans`; direct frontend filesystem reads.
- **Why chosen:** preserves requested UX while maintaining backend mediation and testable contracts.
- **Consequences:** slight coupling at route level; backend service boundary required to prevent domain bleed.
- **Follow-ups:** add detail endpoint only after list view is stable and verified.
