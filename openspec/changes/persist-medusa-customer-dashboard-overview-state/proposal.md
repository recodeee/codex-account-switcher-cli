## Why
After switching to Medusa customer login, operators want each Medusa account to keep its own dashboard state instead of sharing one global runtime view across all users.

## What Changes
- Persist dashboard overview snapshots in Medusa customer metadata under a codex-lb owned key.
- Hydrate the dashboard overview query from the authenticated customer's saved metadata before live polling resolves.
- Keep persistence best-effort so failed metadata reads/writes never block live dashboard loading.

## Impact
- Frontend: `apps/frontend/src/features/dashboard/hooks/use-dashboard.ts`
- Frontend: `apps/frontend/src/features/medusa-customer-auth/*`
- OpenSpec: `openspec/changes/persist-medusa-customer-dashboard-overview-state/*`
