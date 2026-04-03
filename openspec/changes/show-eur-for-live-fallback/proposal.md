## Why
Operators currently lose EUR visibility in the Request Logs usage cards/donuts whenever a window uses live fallback token data. This makes the cost panel look broken (`N/A`) during the exact periods when operators need rapid situational awareness.

## What Changes
- Keep live fallback token behavior for Request Logs usage windows.
- Derive fallback EUR values from available request-log cost density (EUR-per-token and USD-per-token) instead of forcing `N/A`.
- When both request windows lack usable cost density, surface deterministic `€0.00` fallback values rather than unavailable markers.
- Update Request Logs usage UI copy to indicate fallback EUR values are estimated from live fallback context.
- Add frontend tests for fallback-cost estimation and rendering behavior.

## Impact
- Request Logs cards/donuts always show EUR values for 5h and 7d windows.
- Operators no longer see unavailable EUR metrics during fallback operation.
- Behavior remains deterministic and backward compatible with existing payload schema.
