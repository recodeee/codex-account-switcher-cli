## Why
Operators can inspect subscription members from Billing, but they still cannot edit a billed account's seat counts or account settings from the same table. That forces follow-up manual edits outside the dashboard even when the user intent is just to manage the selected business account inline.

## What Changes
- Add an `Edit` action next to `Watch` in the Billing subscription accounts table.
- Add an edit dialog for account-level billing settings, including plan labels, subscription/payment state, entitlement, renewal date, and seat counts.
- Enable the authenticated billing update path so Billing edits are persisted through the Medusa subscription boundary instead of failing closed.

## Impact
- Frontend: `apps/frontend/src/features/billing/*`
- Python billing facade: `app/modules/billing/*`, `tests/unit/test_billing_api.py`, `tests/unit/test_billing_service.py`
- Medusa backend: `apps/backend/src/api/billing/*`, `apps/backend/src/modules/subscription/*`
