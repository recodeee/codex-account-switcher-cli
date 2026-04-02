## Why
The top-right decorative icons in dashboard KPI cards add visual noise without improving scanability. Operators want a cleaner, text-first summary row.

## What Changes
- Remove the top-right icon badge from each dashboard KPI card (requests, tokens, cost, error rate).
- Keep KPI values, metadata text, and bottom trend sparklines unchanged.
- Add/update frontend tests to lock the iconless KPI card header rendering.

## Impact
- Cleaner KPI presentation on `/dashboard`.
- No backend/API changes and no change to dashboard data semantics.
