## 1. Implementation

- [x] 1.1 Update local rollout telemetry reader to preserve active-session detection when fresh files have no `token_count` event yet.
- [x] 1.2 Add fallback logic to use the most recent known local rate-limit snapshot when active files have no rate-limit payload.
- [x] 1.3 Add default-session multi-account fingerprint matching so concurrent active sessions can map to multiple accounts.
- [x] 1.4 Centralize live-usage attribution for dashboard/accounts response composition to avoid logic drift.
- [x] 1.5 Set `codexAuth.hasLiveSession` from telemetry only and keep sticky-session rows as count-only fallback when telemetry is unavailable.
- [x] 1.6 Enforce `codexSessionCount` precedence as telemetry count first, sticky-session fallback second.

## 2. Validation

- [x] 2.1 Add unit coverage for fallback-to-recent-known-usage and active-session-without-rate-limit behavior.
- [x] 2.2 Add integration coverage for dashboard/accounts responses before the first `token_count` event and for multi-account default-session mapping.
- [x] 2.3 Add integration assertions that sticky-session-only accounts are not marked `hasLiveSession`, while telemetry still overrides session counts when available.
- [x] 2.4 Run targeted backend tests and capture results.
