## 1. Specification

- [x] 1.1 Add OpenSpec change for auth-email snapshot attribution fallback.

## 2. Backend implementation

- [x] 2.1 Add auth.json email-identity fallback for live process snapshot attribution.
- [x] 2.2 Materialize missing email-derived snapshot files when fallback attribution succeeds.
- [x] 2.3 Keep existing explicit snapshot/env/current-path attribution precedence unchanged.

## 3. Validation

- [x] 3.1 Add/adjust unit tests for codex live process attribution fallback behavior.
- [x] 3.2 Run targeted unit tests for `tests/unit/test_codex_live_usage.py` and `tests/unit/test_health_probes.py`.
- [x] 3.3 Run `openspec validate --specs`.
