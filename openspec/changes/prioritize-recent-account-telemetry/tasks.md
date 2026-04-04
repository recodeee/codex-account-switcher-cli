## 1. Implementation

- [x] 1.1 Update dashboard account-card grouping to bucket non-working accounts into recent telemetry vs stale telemetry (30-minute threshold).
- [x] 1.2 Keep existing quota ordering inside each bucket.
- [x] 1.3 Keep deactivated accounts after active accounts.

## 2. Verification

- [x] 2.1 Add a frontend test that verifies stale (>30m) accounts are rendered after recent accounts even when stale quota is higher.
- [x] 2.2 Run `npm --prefix frontend run test -- src/features/dashboard/components/account-cards.test.tsx`.
- [x] 2.3 Run `openspec validate --specs`.
