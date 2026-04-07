## Why
Dashboard token cards currently show the active prompt task, but the previous output context is only shown in limited waiting-only cases and uses ambiguous wording (`Last task`). Operators asked for clearer separation between prompt input and prior model output context.

## What Changes
- Rename the prior-context label from `Last task` to `Last codex response`.
- Show `Last codex response` whenever a distinct non-waiting prior preview is available, not only when the current preview is waiting.
- Add/adjust dashboard account-card tests to validate the new label and visibility rules.

## Impact
- Prompt input vs. previous output context is clearly separated in the dashboard card.
- Operators can see latest response context while a new task is actively shown.
