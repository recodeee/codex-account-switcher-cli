## Why

The Rust wildcard bridge currently buffers upstream responses before returning them. That behavior is risky for proxy hot paths (`/api/*`, `/backend-api/*`, `/v1/*`) that can emit streaming payloads (for example SSE/token streams), because buffering can delay first-byte delivery and degrade parity with Python.

## What Changes

- Switch wildcard proxy forwarding in `rust/codex-lb-runtime` to return upstream bodies as streams instead of reading the full payload into memory.
- Keep existing auth/query/body forwarding behavior unchanged.
- Preserve upstream `content-type`, `cache-control`, and `set-cookie` headers while streaming.
- Keep fail-closed JSON `503` behavior when upstream requests fail.
- Extend runtime tests with wildcard stream-content passthrough coverage.

## Impact

- Improves parity and latency characteristics for streaming-capable proxy routes.
- Reduces memory pressure for large wildcard responses.
- Advances Phase-6 proxy hot-path migration without requiring immediate native Rust business logic.
