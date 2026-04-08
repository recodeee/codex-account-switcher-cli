## Why

Billing account editing and creation now go through the Medusa subscription boundary, but the underlying subscription module still keeps account state in process memory. That means seat totals and plan edits disappear on backend restart instead of persisting in the configured Supabase/Postgres database.

## What Changes

- Persist subscription billing accounts and seat rows through the Medusa subscription module's data models.
- Seed the existing fixture-backed billing accounts into module storage the first time the billing store is empty so current dashboard data survives future restarts.
- Add module service tests and a Medusa migration for the subscription account and seat tables.

## Impact

- Medusa backend: `apps/backend/src/modules/subscription/*`
- Specs: `openspec/changes/persist-billing-subscription-storage/specs/subscription-billing/spec.md`
