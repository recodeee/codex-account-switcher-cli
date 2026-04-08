## 1. Spec

- [x] 1.1 Add frontend requirement coverage for billing member-domain grouping and member add/remove controls.
- [x] 1.2 Validate OpenSpec specs.

## 2. Tests

- [x] 2.1 Add failing tests for grouping dashboard accounts into billed business accounts by email domain.
- [x] 2.2 Add failing billing dialog tests for add/remove member controls and save behavior.

## 3. Implementation

- [x] 3.1 Implement billing member grouping helper(s) from active dashboard accounts.
- [x] 3.2 Implement billing dialog member add/remove UI and save flow.
- [x] 3.3 Recompute persisted seat totals from the edited member list before update.

## 4. Verification

- [x] 4.1 Run targeted billing frontend tests.
- [x] 4.2 Run lint/typecheck for touched frontend surfaces.
- [x] 4.3 Run `openspec validate --specs`.
