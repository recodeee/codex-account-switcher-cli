## Why

Accounts with stale telemetry (for example last seen over 30 minutes ago) can appear above recently updated accounts just because their 5h quota percentage is higher. That makes the top of "Other accounts" feel misleading because stale telemetry does not reflect current runtime state.

## What Changes

- In Dashboard "Other accounts", prioritize accounts with recent telemetry first.
- Treat an account as recent when its most recent usage timestamp (primary or secondary, including deferred raw fallback timestamps) is within 30 minutes.
- Keep stale/unknown accounts after recent ones.
- Within each bucket (recent vs stale), keep existing quota-based sorting (5h remaining, then weekly tie-break).

## Impact

- Operators see currently trustworthy account status first.
- Stale accounts are still visible, but deprioritized to the bottom of each status group.
