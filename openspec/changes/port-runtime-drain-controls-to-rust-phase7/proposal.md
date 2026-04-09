## Why

Phase-6 wildcard proxying moved most request traffic into Rust, but core runtime drain behavior still relied on Python-only lifecycle internals. To keep cutover safe, Rust must own graceful shutdown controls for in-flight HTTP requests and bridge drain admission.

## What Changes

- Add shared Rust runtime lifecycle state for:
  - dynamic draining flag,
  - bridge-drain-active flag,
  - in-flight HTTP request counter.
- Add middleware that tracks in-flight HTTP requests while excluding websocket upgrade handshakes.
- On shutdown signal, mark runtime draining + bridge-drain-active and wait for in-flight HTTP drain up to a configurable timeout.
- Enforce fail-closed `503` responses for new responses-bridge HTTP/WS session entrypoints when bridge drain is active.
- Keep `/health/ready` fail-closed when runtime is dynamically draining.

## Impact

- Rust runtime now owns a critical Phase-7 runtime-internal slice (graceful drain controls) instead of relying on Python lifecycle state.
- Reduces shutdown/cutover risk by preventing new bridge sessions during drain and waiting for finite HTTP in-flight requests.
- Preserves fail-closed behavior under shutdown pressure.
