## 1. Implementation

- [x] 1.1 Replace mixed default-session fallback attribution with deterministic global sample/account assignment in `app/modules/accounts/live_usage_overrides.py`.
- [x] 1.2 Keep unique reset-fingerprint attribution as hard-priority anchors during assignment.
- [x] 1.3 Add recall-biased unresolved-sample fallback that updates `hasLiveSession` and `codexSessionCount` without unsafe quota overrides.
- [x] 1.4 Keep usage-window override safety gate: only update primary/secondary windows when reset attribution is unique.

## 2. Verification

- [x] 2.1 Extend unit tests for 3–8 account mixed-session scenarios, deterministic assignment stability, and ambiguous quota-safety behavior.
- [x] 2.2 Extend integration coverage for mixed default-session attribution and quota override safety.
- [x] 2.3 Run `.venv/bin/pytest tests/unit/test_live_usage_overrides.py -q`.
- [x] 2.4 Run `.venv/bin/pytest tests/integration/test_accounts_api.py -k mixed_sessions -q`.
- [x] 2.5 Run `openspec validate --specs`.
