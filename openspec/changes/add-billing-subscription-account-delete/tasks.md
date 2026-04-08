## 1. Spec

- [x] 1.1 Add delta requirements for deleting subscription accounts and keeping add-account access available after removal.
- [x] 1.2 Validate OpenSpec changes with `openspec validate --specs`.

## 2. Tests

- [x] 2.1 Add/update Medusa subscription service and route coverage for deleting a persisted billing account.
- [x] 2.2 Add/update Python billing facade tests for the delete endpoint/service flow.
- [x] 2.3 Add/update frontend billing tests and mock handlers for persisted delete flow.

## 3. Implementation

- [x] 3.1 Add a dedicated Medusa delete-account mutation path that removes the billing account and its seats from persisted storage.
- [x] 3.2 Add Python facade delete support and Medusa client wiring.
- [x] 3.3 Update Billing UI/hooks/api to call the delete endpoint and keep add-account access available when rows are empty.

## 4. Verification

- [x] 4.1 Run targeted frontend tests/lint/typecheck for billing surfaces.
- [x] 4.2 Run targeted backend Python and Medusa tests.
