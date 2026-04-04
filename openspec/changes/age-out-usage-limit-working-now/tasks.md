## 1. Specification

- [x] 1.1 Add OpenSpec change `age-out-usage-limit-working-now`.

## 2. Frontend implementation

- [x] 2.1 Add 60s usage-limit grace/counter helper to working-now utilities.
- [x] 2.2 Update `isAccountWorkingNow` to remove limit-hit accounts from `Working now` after grace.
- [x] 2.3 Show countdown text on limit-hit dashboard cards.
- [x] 2.4 Add red-tinted background styling for limit-hit dashboard card container.

## 3. Validation

- [x] 3.1 Add/update unit tests for working-now grace and expiry behavior.
- [x] 3.2 Add/update account-card tests for countdown rendering and limit-hit styling.
- [x] 3.3 Run targeted frontend tests.
- [x] 3.4 Run `openspec validate --specs`.
