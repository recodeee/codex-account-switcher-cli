## 1. Implementation

- [x] 1.1 Update working-now grace-expiry handling to gate on strong CLI session evidence.
- [x] 1.2 Keep dashboard current-task preview visible after grace expiry when the account is still working.
- [x] 1.3 Preserve stale-preview suppression when grace has expired and working evidence is gone.
- [x] 1.4 Treat terminal session previews (`failed`/`errored`/`stopped`) as settled evidence.

## 2. Validation

- [x] 2.1 Update account working unit tests for grace-expiry behavior with active CLI signals.
- [x] 2.2 Update account-card tests for post-grace task-preview visibility under active CLI signals.
- [x] 2.3 Run targeted frontend test suite for account working/account card behavior.
- [x] 2.4 Run `openspec validate --specs`.
- [x] 2.5 Add regression coverage for terminal errored/stopped session previews.
