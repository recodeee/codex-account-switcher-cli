## Why

After landing live-usage, analytics, and dashboard read-surface bridges, the next migration step is account management and auth surfaces so operator workflows can execute through Rust without direct Python edge ownership.

## What Changes

- Add Rust parity-bridge routes for account management APIs under `/api/accounts/*`.
- Add Rust parity-bridge routes for dashboard auth APIs under `/api/dashboard-auth/*`.
- Add Rust parity-bridge routes for Medusa admin auth APIs under `/api/medusa-admin-auth/*`.
- Forward dashboard auth context (cookies/authorization), content-type, and query params to Python.
- Preserve upstream session cookie behavior by forwarding `Set-Cookie` headers from Python responses.
- Keep fail-closed JSON `503` behavior when upstream is unavailable.

## Impact

- Rust layer now owns additional migration-critical API edges while Python keeps business logic.
- Dashboard account/auth operations can be exercised through Rust in shadow/canary drills.
- Rollback remains fast because this slice remains a reversible bridge.
