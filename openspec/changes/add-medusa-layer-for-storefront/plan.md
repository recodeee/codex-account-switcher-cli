# Medusa Layer Adoption Plan (WEBU -> codex-lb)

## Goal
Introduce a Medusa commerce backend + Medusa-aware storefront layer into `codex-lb`, using Supabase Postgres as the backend database, while keeping the existing Python proxy stack isolated from commerce concerns.

## Constraints from request
- Do **not** put Medusa logic into the Python proxy server path.
- Add a Medusa backend layer inspired by `WEBU/apps/backend`.
- Add a Medusa storefront layer into the current Next.js storefront (`frontend/`).
- Database backend for the Medusa layer: **Supabase**.
- Begin implementation from this plan without introducing Medusa logic into `app/`.

## Target architecture (planned)
1. **Existing Python backend (`app/`) remains dedicated** to codex-lb proxy/dashboard APIs.
2. **New Medusa backend service** is added as a separate service boundary.
3. **Next.js storefront (`frontend/`) gets a Medusa integration layer** for commerce features.
4. **Supabase Postgres** is provisioned/configured for Medusa data.
5. Local/dev orchestration runs all required services together without coupling Medusa internals into `app/`.

## Scope
### In scope
- Repo structure plan for introducing Medusa backend/storefront layers
- Integration boundary plan between Python backend and Medusa backend
- Supabase DB, migration, and environment planning for Medusa
- Task sequencing and status tracking

### Out of scope (current phase)
- Data migration execution on production environments
- Cutover/deployment execution

## Task status board
Status values: `Not Started`, `In Progress`, `Blocked`, `Done`

| ID | Task | Status | Notes |
|---|---|---|---|
| T01 | Baseline architecture decision record (service boundaries + repo layout) | In Progress | Service boundary implemented; ADR write-up pending |
| T02 | Inventory + map WEBU backend modules to codex-lb needs | Done | Backend scaffold copied into `backend/apps/backend` |
| T03 | Define Medusa backend bootstrap plan in this repo | Done | Medusa backend service scaffold + runtime scripts added |
| T04 | Define Supabase schema + migration strategy for Medusa | In Progress | Supabase workspace copied and normalized to `commerce` schema |
| T05 | Define storefront integration adapter for current Next.js app | Done | `frontend/src/lib/medusa/*` adapter layer created |
| T06 | Define auth/session strategy between storefront and Medusa | Not Started | Include customer + admin auth approach |
| T07 | Define storefront route ownership and composition strategy | Not Started | Existing pages vs Medusa-powered commerce routes |
| T08 | Define local orchestration plan (docker compose/services/networking) | Done | `docker-compose.yml` includes optional `medusa` profile |
| T09 | Define deployment topology + secrets handling for Medusa and Supabase | Not Started | Environment parity + secret isolation |
| T10 | Define observability + runbook requirements for Medusa path | Not Started | Logging/metrics/alerts for commerce paths |
| T11 | Define test strategy (unit/integration/contract/e2e) | Not Started | Must include Medusa-storefront contracts |
| T12 | Define phased rollout + rollback criteria | Not Started | Shadow -> internal beta -> public gates |
| T13 | Produce implementation-ready sign-off checklist | Not Started | Gate before code implementation |
| T14 | Dependency/risk review checkpoint | Not Started | Resolve blockers before coding |
| T15 | Final planning approval checkpoint | Not Started | Explicit go/no-go for implementation |


## Milestones
- **M1 (Planning Ready):** T01-T03 Done
- **M2 (Data + Integration Ready):** T04-T06 Done
- **M3 (Storefront + Runtime Ready):** T07-T10 Done
- **M4 (Execution Gate Ready):** T11-T15 Done

## Risks to manage in execution phase
- Hidden coupling between existing Next.js app and codex-lb APIs
- Medusa module drift from WEBU reference implementation
- Supabase configuration mismatch (extensions, roles, migration order)
- Auth/session complexity across service boundaries

## Exit criteria for this planning phase
- `plan.md` and `tasks.md` agreed and tracked
- Clear separation of Python proxy vs Medusa backend responsibilities
- Implementation can start task-by-task without re-architecting
