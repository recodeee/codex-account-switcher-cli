## Why

Dashboard `Working now` can show random accounts with `codexLiveSessionCount = 0` and
`codexTrackedSessionCount = 0` when `liveQuotaDebug.rawSamples` exist under
`deferred_active_snapshot_mixed_default_sessions`. In this deferred mode, raw samples are
presence hints from mixed default-session files and are not strong evidence of an active
session for the specific account.

## What Changes

- Update frontend working-now detection to ignore raw-sample-only signals for
  `deferred_active_snapshot_mixed_default_sessions` unless an active session signal exists
  (`codexAuth.hasLiveSession` or session counters > 0).
- Keep existing raw-sample fallback behavior for non-deferred reasons (for example,
  `missing_live_usage_payload`).

## Impact

- Reduces false positive `Working now` cards caused by mixed default-session attribution.
- Preserves fallback behavior where raw samples are still a valid signal outside deferred
  mixed-session mode.
