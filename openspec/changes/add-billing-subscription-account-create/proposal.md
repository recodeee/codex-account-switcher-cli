## Why

Operators can view live subscription accounts in `/billing`, but they currently cannot add a missing billed account from the dashboard. This blocks fast onboarding when a new business account should be tracked immediately.

## What Changes

- Add a Billing UI action to create a subscription account directly from `/billing`.
- Add an authenticated dashboard API endpoint for creating one subscription account.
- Route creation through the Medusa subscription boundary so newly added accounts show up in the live billing summary path.
- Add frontend/backend tests for create flow success and validation failures.

## Impact

- Frontend: `apps/frontend/src/features/billing/*` and MSW handlers/tests.
- Python billing facade: `app/modules/billing/*`, `tests/unit/test_billing_api.py`, `tests/unit/test_billing_service.py`.
- Medusa backend: `apps/backend/src/api/billing/accounts/*`, `apps/backend/src/modules/subscription/*`.
