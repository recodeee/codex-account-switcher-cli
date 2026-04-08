## 1. Specification

- [x] 1.1 Add OpenSpec change `add-dashboard-live-usage-websocket-invalidation` for dashboard websocket invalidation + task preview wrapper sanitization.
- [x] 1.2 Define acceptance scenarios for websocket-driven refresh and control-wrapper stripping.

## 2. Backend implementation

- [x] 2.1 Add `/api/dashboard/overview/ws` websocket endpoint with dashboard-session validation.
- [x] 2.2 Add live update observer that emits invalidate/heartbeat events when live usage/task-preview fingerprint changes.
- [x] 2.3 Extract shared dashboard websocket auth validator and reuse it in account terminal websocket route.
- [x] 2.4 Extend task preview sanitizer to strip `<skill>`, `<hook_prompt>`, `<subagent_notification>` control wrappers.

## 3. Frontend implementation

- [x] 3.1 Add dashboard live websocket hook and invalidate `['dashboard','overview']` on invalidation events.
- [x] 3.2 Keep adaptive polling fallback active and apply slower safety polling when websocket is connected.

## 4. Verification

- [x] 4.1 Run backend targeted tests (websocket auth/events + sanitizer regressions).
- [x] 4.2 Run frontend targeted tests (dashboard hooks/components).
- [x] 4.3 Run `openspec validate --specs`.
