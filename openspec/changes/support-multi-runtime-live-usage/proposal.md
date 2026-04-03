## Why

Dashboard live overrides currently read only one local sessions directory, so when operators run multiple runtime profiles (different accounts in different terminals), only one account receives live Codex session/5h/weekly updates.

## What Changes

- Extend local rollout telemetry to read live usage per snapshot across runtime-scoped directories (`~/.codex/runtimes/<runtime>/sessions`).
- Apply dashboard/accounts live overrides by snapshot name (not only the single active snapshot).
- Expose a runtime-live-session flag in account codex-auth status so UI can indicate multiple concurrently working accounts.

## Expected Outcome

- Multiple concurrently running runtime profiles can each show accurate live `Codex sessions` and `5h/Weekly` values on their own account cards.
- Dashboard `Working now` state can reflect concurrent runtime activity instead of a single global active snapshot.
