## Why
Operators currently see request-log consumed token counts but cannot see estimated EUR value for that same consumption in the Request Logs usage section.

## What Changes
- Extend `/api/request-logs/usage-summary` to return token + cost totals for 5h and 7d windows, including per-account cost values.
- Add a fixed configurable USD→EUR conversion rate in backend settings and expose it in usage-summary payloads.
- Update Request Logs usage cards and donuts to display EUR values alongside tokens.
- Keep fallback behavior for live-window token data, but mark EUR values as unavailable (`N/A`) when a window is using fallback.
- Add backend and frontend test coverage for the new cost fields and fallback presentation behavior.

## Impact
- Request Logs usage analytics become cost-aware without changing filtering behavior.
- EUR display is deterministic and tied to a single configured FX rate.
- Users avoid misleading EUR values when request logs are empty and fallback windows are used.
