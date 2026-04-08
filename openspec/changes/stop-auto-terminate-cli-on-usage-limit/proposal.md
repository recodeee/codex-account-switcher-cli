## Why

When a working account hits quota, the dashboard currently auto-dispatches `terminateCliSessions` after the 60s grace window. This force-terminates live Codex terminals even when operators still need the running CLI context to continue work handoff.

## What Changes

- Remove dashboard-side auto-dispatch of `terminateCliSessions` after usage-limit grace expiry.
- Keep the existing usage-limit badge/countdown behavior for visibility.
- Preserve manual session termination actions.

## Impact

- Quota-hit sessions are no longer force-killed by UI timers.
- Operators can keep CLI terminals alive and decide termination manually.
