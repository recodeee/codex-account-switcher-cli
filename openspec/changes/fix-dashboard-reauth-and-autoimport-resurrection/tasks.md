## 1. Dashboard re-auth flow
- [x] 1.1 Update dashboard action handler so `reauth` navigates to account details directly.
- [x] 1.2 Update dashboard integration tests to match the new behavior.

## 2. Auto-import resurrection guard
- [x] 2.1 Add file-backed ignored-account list helper for codex-auth auto-import.
- [x] 2.2 Mark deleted accounts as ignored.
- [x] 2.3 Un-ignore IDs on explicit manual import.
- [x] 2.4 Skip ignored IDs during snapshot auto-import.

## 3. Verification
- [x] 3.1 Add/adjust integration tests for dashboard re-auth and deleted-account non-resurrection.
- [x] 3.2 Run targeted frontend/backend test suites.
