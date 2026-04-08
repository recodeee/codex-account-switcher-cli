## Why
Operators can see billed-account counts and seat counts, but they still cannot see the combined monthly euro total for those billed subscription accounts in the Billing dashboard. The user explicitly wants the dashboard to surface that total using the current pricing rule.

## What Changes
- Add a Billing summary card that shows the monthly euro total derived from live seat counts.
- Use the current pricing rule of `€26` per ChatGPT seat and `€0` per Codex seat.
- Show the pricing formula inline so the total is easy to audit.

## Impact
- Frontend: `apps/frontend/src/features/billing/*`
- OpenSpec: `openspec/changes/add-billing-monthly-spend-summary/*`
