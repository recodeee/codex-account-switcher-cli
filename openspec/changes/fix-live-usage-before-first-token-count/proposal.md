## Why

When a brand-new local Codex session starts, the dashboard can temporarily show stale 5h/weekly remaining percentages until the first `token_count` event is emitted. This creates a confusing "updates only after first message" experience.

## What Changes

- Keep detecting active local sessions immediately from recent rollout files, even when those files do not yet contain a `token_count` payload.
- When active session files have no fresh rate-limit payload yet, fall back to the most recent known rate-limit snapshot from nearby rollout files.
- When multiple active default-session rollout files are present, use reset-time fingerprint matching to map live usage/session activity across multiple accounts instead of attributing all activity to the single active snapshot.
- Unify live-usage attribution logic used by both `/api/dashboard/overview` and `/api/accounts` so live-session badges, session counts, and usage overrides are produced by the same helper path.
- Tighten live-session semantics:
  - `codexAuth.hasLiveSession` is telemetry-confirmed only (live rollout/runtime telemetry), not sticky-session fallback.
  - `codexSessionCount` prefers telemetry counts when telemetry is present; sticky-session counts are used only when telemetry is unavailable.
- Continue overriding dashboard/accounts usage only when a valid live rate-limit snapshot is available.

## Expected Outcome

- Active account cards can reflect current live-session activity before the first prompt is sent.
- 5h/weekly remaining percentages are no longer stuck waiting for the first message when recent known local telemetry exists.
- Concurrent active accounts from default local sessions can retain their own `Working now` and usage values instead of one account taking over all live telemetry.
