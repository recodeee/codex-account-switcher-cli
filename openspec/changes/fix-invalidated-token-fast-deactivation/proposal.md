## Why

Dashboard polling currently defers account deactivation for invalidated-token `401` errors until the generic repeated-client-error threshold is reached. In practice this leaves clearly disconnected Codex accounts in an active-looking state for multiple polling cycles, producing repeated `Token refresh failed` noise and confusing operators who are already signed into Medusa.

## What Changes

- Keep the existing forced refresh + retry behavior for invalidated-token `401` responses.
- If the invalidated-token marker still appears after the retry path fails, deactivate the account immediately instead of waiting for the repeated-client-error threshold.
- Keep streak-threshold deactivation behavior for non-invalidated client errors (`402`, `403`, etc.).

## Impact

- Invalidated Codex accounts fail closed faster and stop repeated retry noise.
- Recoverable first-pass invalidated-token `401` cases that succeed after forced refresh remain active.
- Generic client-error streak protection remains unchanged for non-invalidated errors.
