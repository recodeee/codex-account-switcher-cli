## Why

Users with active Codex CLI terminals can still appear outside the `Working now` section when live quota telemetry has not yet arrived. In that state, dashboard cards show tracked sessions, but the account is not highlighted as currently working.

## What Changes

- Treat tracked Codex session inventory (`codexTrackedSessionCount > 0`) as a valid `working now` signal in frontend detection.
- Keep compatibility with payloads that still report `codexSessionCount` while split live/tracked counters converge.
- Keep live-only telemetry affordances (live chips and live session summary) tied to fresh live telemetry.
- Continue grouping working accounts above other accounts.
- Prefer `liveQuotaDebug.merged` percentages for card quota display to avoid stale `0%` floor artifacts.
- Treat non-stale `liveQuotaDebug.rawSamples` as a working-now signal so sampled accounts appear in the top section.
- Apply merged quota percentages on the Accounts page sidebar/detail usage rows as well, not only dashboard cards.
- When raw samples exist but counters are zero, surface a fallback `Codex CLI sessions` count from fresh sample inventory.
- For disconnected accounts under mixed default-session telemetry, use conservative merged live quotas (lowest remaining in-cycle) and persist those provisional windows so refreshes do not bounce back to stale floors.

## Impact

- Accounts with active CLI terminals are surfaced in `Working now` immediately.
- Fast polling stays active while tracked sessions are present.
- Live telemetry visuals remain conservative and only appear for true live telemetry.
