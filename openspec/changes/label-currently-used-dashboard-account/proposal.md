## Why
Dashboard account cards keep showing `Use this account` even when the rendered account is already the currently selected local snapshot. That reads like a pending action instead of current state.

## What Changes
- Update the dashboard account-card primary CTA label to read `Currently used` when the card represents the active local snapshot.
- Keep the existing enabled/disabled gating and success styling unchanged.
- Add regression coverage for active-snapshot labeling while preserving the existing pending-switch state label.

## Impact
- Makes dashboard account cards communicate current local-selection state more clearly.
- Avoids implying that users still need to switch to an account that is already in use.
