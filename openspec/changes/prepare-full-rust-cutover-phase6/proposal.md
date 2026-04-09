## Why

The Python runtime is becoming a bottleneck for quota/session-heavy dashboard traffic, and frontend integration still depends on per-endpoint Rust routing work. We need one cutover step that lets the frontend use the Rust edge broadly while preserving Python business logic behind it.

## What Changes

- Add wildcard Rust proxy routes for:
  - `/api/{*path}`
  - `/backend-api/{*path}`
  - `/v1/{*path}`
- Keep existing explicit parity routes (`/health*`, `/live_usage*`, dashboard/read APIs) while enabling wildcard forwarding for remaining surfaces.
- Forward method, path, query params, auth/session headers (`cookie`, `authorization`), and request `content-type`.
- Preserve upstream auth/session behavior by forwarding `Set-Cookie` response headers from Python.
- Keep fail-closed JSON `503` behavior when Python upstream is unavailable.

## Impact

- Frontend traffic can run through Rust for quota/auth/account and API surfaces without waiting on per-endpoint route scaffolding.
- Reduces Python edge pressure while keeping Python as source-of-truth logic during migration.
- Keeps cutover reversible because Rust remains a parity bridge layer.
