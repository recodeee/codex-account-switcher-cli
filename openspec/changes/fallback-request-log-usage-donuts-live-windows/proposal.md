## Why
Request Logs consumed-token donuts currently rely only on `/api/request-logs/usage-summary`. When recent request logs are empty, both donuts display `0` even if dashboard live usage windows already show consumed credits for the same 5h/weekly periods.

## What Changes
- Keep `/api/request-logs/usage-summary` as the primary source for consumed-token donuts.
- Add frontend-only fallback composition from `overview.windows`:
  - 5h fallback source: `overview.windows.primary`
  - weekly fallback source: `overview.windows.secondary`
  - consumed per row: `max(0, capacityCredits - remainingCredits)`
- Merge per window independently:
  - Use request-log `last5h` when non-zero, otherwise use live 5h fallback.
  - Use request-log `last7d` when non-zero, otherwise use live weekly fallback.
- Extend donut component inputs with fallback metadata and render an explicit note when fallback is active:
  - `Using live usage fallback because recent request logs are empty.`

## Impact
- Donuts remain current before recent request logs are available.
- Request-log totals stay authoritative when non-zero.
- No backend API or wire-contract changes are required.
