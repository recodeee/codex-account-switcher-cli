## 1. Implementation
- [ ] 1.1 Update usage-updater deactivation logic so invalidated-token `401` errors bypass the repeated-failure threshold and deactivate immediately.
- [ ] 1.2 Keep forced refresh + retry behavior unchanged for recoverable invalidated-token `401` cases.
- [ ] 1.3 Keep repeated-failure threshold behavior for non-invalidated client errors.

## 2. Regression coverage
- [ ] 2.1 Update invalidated-token tests to assert immediate deactivation even when threshold > 1.
- [ ] 2.2 Keep/confirm test coverage that non-invalidated `4xx` errors still defer until threshold.

## 3. Verification
- [ ] 3.1 Run targeted unit tests for `tests/unit/test_usage_updater.py`.
- [ ] 3.2 Run lint/type checks for modified backend test/code files.
- [ ] 3.3 Validate specs with `openspec validate --specs`.
