## Why
Operators currently see remaining quota donuts, but they cannot quickly see consumed token totals from actual request logs for short-term (5h) and weekly (7d) windows in one place under Request Logs.

## What Changes
- Add a dashboard request-log usage summary API that returns consumed tokens for rolling last 5 hours and rolling last 7 days.
- Include per-account token breakdown and total token counts for both windows.
- Add a new Request Logs usage donut panel (5h consumed + weekly consumed) above filters/table.
- Keep usage-summary windows global and independent from Request Logs table filters.
- Add backend and frontend tests for aggregation and rendering behavior.

## Impact
- Operators can compare consumed token load per account and globally without leaving the dashboard.
- Request-log filter and pagination behavior remains unchanged.
