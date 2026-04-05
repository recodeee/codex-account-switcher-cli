## Why
Dashboard account cards currently show mapped live CLI session counts and task fallbacks, but the expanded CLI session debug panel only exposes quota-bearing sample rows. When a session is mapped yet only provides presence signals (for example while waiting for a new task), the panel falls back to `no cli sessions sampled`, which makes correctly mapped live sessions look unattributed.

## What Changes
- Clarify the account-card debug output so it distinguishes mapped live sessions from quota-bearing sample rows.
- Surface when mapped live sessions exist without quota rows and indicate the waiting-for-task fallback state in the debug panel.
- Keep existing quota sample rows unchanged when telemetry is available.

## Impact
- Operators can tell the difference between missing attribution and mapped sessions that simply lack quota/task payloads.
- No API contract changes; this is a frontend debug-output clarification.
