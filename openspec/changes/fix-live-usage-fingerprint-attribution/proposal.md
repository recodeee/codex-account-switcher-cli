## Why

Dashboard cards can show `Working now` for an account while the 5h/weekly quota bars stay stale when local default-session telemetry is mixed and attribution is deferred for safety.

This is confusing for operators actively using one account (for example `odin`) because the CLI shows current limits while the dashboard card may keep old percentages.

## What Changes

- Keep the existing safety gate that avoids blind active-snapshot quota overrides when default-session telemetry may be mixed.
- Improve fallback attribution by applying per-account quota overrides from fingerprint-matched local samples only when reset fingerprints are uniquely attributable to one account.
- Preserve existing behavior for ambiguous matches: keep session presence/count updates but do not overwrite quota percentages.
- Add unit coverage for both unique and ambiguous reset-fingerprint cases.

## Impact

- Dashboard account cards are more likely to display current 5h/weekly usage for actively matched accounts.
- Cross-account quota bleed risk remains guarded by unique-reset checks.
