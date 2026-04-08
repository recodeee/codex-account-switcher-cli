## Why

Dashboard live usage/task preview updates currently depend on polling intervals. This can leave visible lag after local session-state changes, and some orchestration wrapper payloads can still leak into task preview rows.

## What Changes

- Add dashboard websocket invalidation stream at `/api/dashboard/overview/ws`.
- Keep `/api/dashboard/overview` as canonical payload source; websocket only signals refetch.
- Reuse dashboard session authentication for websocket routes (fail closed when unauthenticated).
- Extend task preview sanitization to strip control wrapper payloads (`<skill>`, `<hook_prompt>`, `<subagent_notification>`).
- Add regression tests for websocket invalidation and preview sanitizer behavior.

## Impact

- Dashboard updates become near-live without increasing constant polling pressure.
- Account/session task previews show user task text more reliably.
- Existing account-working detection cascade and REST response contract remain unchanged.
