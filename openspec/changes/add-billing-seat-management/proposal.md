## Why

Operators need a dedicated Billing tab in the dashboard to manage team seats and understand monthly ChatGPT seat cost at a glance.

## What Changes

- Add a new top-level `Billing` route and navigation item in the frontend layout.
- Add a Billing page that mirrors business-plan style seat information and user seat assignment.
- Show ChatGPT per-seat monthly pricing (`€26/month`), calculated monthly total based on assigned seats, and the current billing cycle (`Mar 23 - Apr 23`).
- Allow adding a new member seat from the Billing page and update the monthly total immediately.
- Add frontend tests for billing page behavior and navigation coverage.

## Impact

- Code: `apps/frontend/src/App.tsx`, `apps/frontend/src/components/layout/*`, `apps/frontend/src/features/billing/*`, `apps/frontend/src/__integration__/navigation-flow.test.tsx`
- Tests: Billing page component tests and navigation integration updates
- Specs: `openspec/specs/frontend-architecture/spec.md`
