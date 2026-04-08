# verifier tasks

## 1. Spec

- [x] 1.1 Define end-to-end validation matrix for `dashboard-live-usage-websocket`
- [x] 1.2 Validate success/failure conditions and evidence requirements

## 2. Tests

- [x] 2.1 Execute verification commands and collect outputs
- [x] 2.2 Validate idempotency/re-run behavior and error-path handling

## 3. Implementation

- [x] 3.1 Verify completed work against acceptance criteria
- [x] 3.2 Produce pass/fail findings with concrete evidence links
- [x] 3.3 Publish final verification sign-off (or blocker report)

## 4. Checkpoints

- [x] [V1] READY - Verification checkpoint

## Verification evidence (2026-04-08)

- PASS: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_dashboard_overview_websocket.py tests/integration/test_accounts_terminal_websocket.py tests/unit/test_codex_live_usage.py -k 'control_wrapper or dashboard_overview_websocket or local_codex_task_previews_by_session_id_ignores_control_wrapper_only_payloads or local_codex_task_previews_by_session_id_strips_leading_control_wrapper_and_keeps_task_text or local_codex_task_previews_by_session_id_strips_trailing_control_wrapper_payload' -q` (`5 passed`)
- PASS: `cd apps/frontend && bun run test -- src/features/dashboard/hooks/use-dashboard-live-socket.test.ts src/features/dashboard/hooks/use-dashboard.test.ts` (`8 passed`)
- PASS: `cd apps/frontend && bun run lint -- src/features/dashboard/hooks/use-dashboard-live-socket.ts src/features/dashboard/hooks/use-dashboard.ts src/features/dashboard/hooks/use-dashboard-live-socket.test.ts src/features/dashboard/hooks/use-dashboard.test.ts`
- PASS: `openspec validate --specs`
- BLOCKER NOTE: Broader suites currently fail in pre-existing dirty workspace areas outside this plan scope (`tests/integration/test_dashboard_overview.py`, `apps/frontend/src/features/dashboard/components/account-card.test.tsx` typecheck/assertion failures).

## Fresh re-verification evidence (2026-04-08T19:24Z–19:26Z)

- PASS: `PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_dashboard_overview_websocket.py tests/integration/test_accounts_terminal_websocket.py tests/unit/test_codex_live_usage.py -k 'control_wrapper or dashboard_overview_websocket or local_codex_task_previews_by_session_id_ignores_control_wrapper_only_payloads or local_codex_task_previews_by_session_id_strips_leading_control_wrapper_and_keeps_task_text or local_codex_task_previews_by_session_id_strips_trailing_control_wrapper_payload' -q` (`5 passed`, run at `2026-04-08T19:24:58Z`)
- PASS: `cd apps/frontend && bun run test -- src/features/dashboard/hooks/use-dashboard-live-socket.test.ts src/features/dashboard/hooks/use-dashboard.test.ts` (`8 passed`, run at `2026-04-08T19:25:08Z`)
- PASS: `cd apps/frontend && bun run test -- src/features/dashboard/hooks/use-dashboard-live-socket.test.ts src/features/dashboard/hooks/use-dashboard.test.ts src/features/dashboard/components/account-card.test.tsx src/features/dashboard/components/account-cards.test.tsx` (`141 passed`, run at `2026-04-08T19:26:17Z`)
- PASS: `cd apps/frontend && bun run typecheck` (run at `2026-04-08T19:25:53Z`)
- PASS: `openspec validate --specs` (run at `2026-04-08T19:25:15Z`)
- REMAINS BLOCKED (outside current websocket/sanitizer scope): `tests/integration/test_dashboard_overview.py` still fails in six mixed-session/local-usage scenarios when run standalone and in the broader backend bundle.
