## Why

When an account reaches 5h usage limit (`0%` remaining), it can stay in the `Working now` section too long if session signals remain present. This keeps exhausted accounts pinned in the active block and confuses switching decisions.

Operators want exhausted accounts to:

- visually stand out as exhausted,
- show a short grace countdown,
- then leave `Working now` automatically.

## What Changes

- Add a 60-second grace window for usage-limit-hit accounts in `Working now`.
- During grace, show a visible countdown on the dashboard account card.
- After grace expires, treat the account as non-working for `Working now` grouping.
- Tint usage-limit-hit account card container red to improve visual triage.

## Impact

- `Working now` focuses on actionable accounts.
- Exhausted accounts remain briefly visible with clear removal timing.
- Visual severity is improved for limit-hit cards.
