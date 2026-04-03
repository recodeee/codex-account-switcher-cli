## Why
Operators can miss currently active accounts because `Working now` cards are mixed into the full grid. While an account is actively running, the 5h quota card should also feel live and refresh quickly enough to reflect changing token usage.

## What Changes
- Split the dashboard account grid into a top `Working now` section and a lower section for the remaining accounts.
- Keep `Working now` accounts visually prioritized at the top whenever at least one account is active/live.
- Improve the 5h quota presentation for active accounts with explicit live status styling and token status affordances.
- Increase dashboard overview polling cadence while any account is working so the token/quota status updates feel real-time.
- Add/adjust frontend tests for section ordering and live polling behavior.

## Impact
- Faster operator recognition of currently active work.
- Better live feedback for 5h usage while sessions are active.
- Slightly higher dashboard polling frequency only when active work is detected.
