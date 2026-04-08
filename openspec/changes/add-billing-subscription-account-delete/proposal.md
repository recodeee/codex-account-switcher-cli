## Why

Billing already supports persisted subscription-account creation, but deleting an account still goes through the bulk update path that explicitly rejects any change to the existing account set. Operators can open the delete dialog, but the save never reaches the Medusa/Supabase-backed subscription store.

## What Changes

- Add a dedicated subscription-account delete path through the Medusa billing boundary.
- Expose a matching authenticated dashboard delete endpoint in the Python facade.
- Update the Billing page to use the delete endpoint and keep account creation reachable after rows are removed.

## Impact

- Frontend: `apps/frontend/src/features/billing/*`, test mocks, billing page tests.
- Python billing facade: `app/modules/billing/*`, `tests/unit/test_billing_api.py`, `tests/unit/test_billing_service.py`.
- Medusa backend: `apps/backend/src/api/billing/accounts/*`, `apps/backend/src/modules/subscription/*`.
