## 1) Architecture and Discovery

- [ ] T01 Create architecture decision record for service boundaries (Python proxy vs Medusa backend vs Next.js storefront)
- [x] T02 Audit `WEBU/apps/backend` and map reusable modules/config into a codex-lb adoption matrix
- [x] T03 Finalize repository layout and bootstrap strategy for new Medusa backend service

## 2) Data Layer (Supabase)

- [ ] T04 Define Supabase DB requirements for Medusa (schemas, extensions, roles, connection policy)

## 3) Storefront + Service Contracts

- [x] T05 Define storefront integration adapter boundary in current Next.js app (SDK/API client, caching, error handling)
- [ ] T06 Define auth/session strategy between storefront and Medusa services
- [ ] T07 Define storefront route ownership/composition (existing pages vs Medusa-powered commerce routes)

## 4) Runtime, Delivery, and Operations

- [x] T08 Define local orchestration plan (docker compose/services/networking)
- [ ] T09 Define deployment topology and secrets handling for Medusa + Supabase
- [ ] T10 Define observability and runbook requirements for Medusa paths

## 5) Quality and Rollout Gate

- [ ] T11 Define test strategy (unit, integration, contract, e2e) for cross-service flows
- [ ] T12 Define phased rollout plan (shadow/internal beta/public) and rollback criteria
- [ ] T13 Produce implementation-ready sign-off checklist
- [ ] T14 Run dependency/risk review checkpoint and resolve blockers
- [ ] T15 Run final planning approval checkpoint (go/no-go for implementation)
