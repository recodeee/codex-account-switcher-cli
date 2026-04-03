## 1. Implementation
- [x] 1.1 Update local default-session fingerprint fallback to apply per-account quota overrides when reset fingerprint match is unique.
- [x] 1.2 Keep ambiguous-match behavior session-only (no quota overwrite).

## 2. Verification
- [x] 2.1 Add/update unit tests for:
  - unique reset fingerprint => session + quota override
  - non-unique reset fingerprint => session-only, baseline quota retained
- [x] 2.2 Run targeted unit tests for live usage overrides.
