# Add codex-auth list account type labels

## Goal

Show the account type in `codex-auth list` rows so operators can distinguish Codex usage-based accounts from ChatGPT seat plans.

## Acceptance

- Bare `codex-auth list` includes a `type=` field before quota percentages.
- Usage-based Codex plans render as `Usage based (Codex)`.
- ChatGPT seat plans render with tier labels for Plus, Business, Pro, and Max.
- `codex-auth list --details` includes the same friendly `type=` label while keeping raw `plan=` metadata.
- Focused TypeScript tests cover the formatter.
