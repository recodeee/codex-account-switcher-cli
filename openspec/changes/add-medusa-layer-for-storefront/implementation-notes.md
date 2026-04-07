# Implementation Notes (phase 1)

## Plan source

- `openspec/changes/add-medusa-layer-for-storefront/plan.md`

## What was implemented

1. Added a separate Medusa backend service scaffold:
   - `backend/apps/backend/`
   - Source copied from `WEBU/apps/backend` and normalized for codex-lb usage.
2. Added storefront integration boundary in Next.js frontend:
   - `frontend/src/lib/medusa/config.ts`
   - `frontend/src/lib/medusa/client.ts`
3. Added local runtime orchestration:
   - `docker-compose.yml` now contains optional `medusa` profile services:
     - `medusa-backend`
     - `medusa-redis`
4. Added environment templates:
   - `.env.example` Medusa section
   - `backend/apps/backend/.env.template`

## WEBU backend adoption matrix (initial)

| WEBU source | codex-lb target | Decision |
|---|---|---|
| `WEBU/apps/backend/package.json` | `backend/apps/backend/package.json` | Adopted (renamed package + log path tweak) |
| `WEBU/apps/backend/medusa-config.ts` | `backend/apps/backend/medusa-config.ts` | Adopted |
| `WEBU/apps/backend/src/**` | `backend/apps/backend/src/**` | Adopted |
| `WEBU/apps/backend/scripts/dev-singleton.js` | `backend/apps/backend/scripts/dev-singleton.js` | Adopted with path matcher tweak |
| `WEBU/apps/backend/supabase/**` | `backend/apps/backend/supabase/**` | Partially adopted (trimmed to Medusa-related migrations, schema normalized to `commerce`) |
| `WEBU/apps/backend/.env` | _not copied_ | Skipped (contains environment-specific secrets/values) |
| `WEBU/apps/backend/.git`, `node_modules` | _not copied_ | Skipped |

## Remaining work

- T01 ADR write-up for permanent repo/service topology.
- T04 finalize Supabase migration policy + production migration order.
- T06-T07 auth/session + route ownership decisions.
- T09-T15 rollout, observability, test, and go/no-go gates.
