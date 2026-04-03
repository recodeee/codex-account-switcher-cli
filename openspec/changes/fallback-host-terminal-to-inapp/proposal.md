## Why
Dashboard Terminal currently depends on opening a host OS terminal window. In containerized/runtime-isolated environments, host terminal launch can fail even though the in-app websocket terminal is fully functional.

## What Changes
- Keep host terminal launch as the primary behavior for the Dashboard `Terminal` action.
- Add a frontend fallback: when host launch fails with `terminal_launch_failed`, open the existing in-app terminal workspace for the selected account.
- Preserve host-launch success behavior and existing API contract.

## Impact
- Operators can still open a working terminal from Dashboard in environments without host terminal apps.
- No backend API shape changes.
- Error handling becomes resilient instead of terminal-action dead-end.
