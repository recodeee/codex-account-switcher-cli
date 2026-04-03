## 1. Implementation

- [x] 1.1 Add live-usage persistence helper that writes per-account primary/secondary override rows only when newer + changed.
- [x] 1.2 Extend live override composition to return persist candidates and call persistence from both accounts-list and dashboard-overview paths.
- [x] 1.3 Update dashboard card token-consumed derivation to skip unknown usage rows and preserve request-usage fallback.
- [x] 1.4 Update dashboard card session display to active-now semantics only and keep sessions-page semantics unchanged.
- [x] 1.5 Surface stale "last seen" labels on quota bars when not currently live.

## 2. Validation

- [x] 2.1 Add backend unit/integration coverage for live-override persistence (write on changed/newer, skip unchanged/stale).
- [x] 2.2 Add/adjust frontend component tests for unknown-row token fallback and active-now session rendering.
- [x] 2.3 Run targeted backend + frontend tests and `openspec validate --specs`.
