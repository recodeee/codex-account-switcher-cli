## Context

codex-lb already supports Medusa admin email/password login from the account menu, and the dashboard backend already has a proven TOTP + QR implementation for dashboard auth. However, Medusa itself does not provide built-in admin TOTP enrollment with QR setup in this repository's current configuration. We need a path that keeps second-factor state attached to the Medusa admin account while reusing codex-lb's existing UX patterns.

## Goals / Non-Goals

**Goals:**
- Bind second-factor state to the Medusa admin user account.
- Keep the codex-lb account menu as the main Medusa admin login/manage surface.
- Require TOTP verification before codex-lb treats a Medusa admin session as active when 2FA is enabled.
- Generate QR locally without leaking the otpauth URI to a third-party service.

**Non-Goals:**
- Replacing Medusa's stock admin login screen or guaranteeing direct stock-admin 2FA enforcement in this change.
- Reusing dashboard-auth session cookies or dashboard-auth settings as Medusa auth state.
- Introducing recovery codes, backup devices, or organization-wide SSO policy.

## Decisions

### Store Medusa 2FA state on the Medusa admin user metadata
Use Medusa admin user metadata for the 2FA record (`enabled`, encrypted secret, last verified step, timestamps) rather than creating a new Medusa module/table. This avoids schema churn while keeping state owned by the Medusa account.

**Alternatives considered:**
- New Medusa module/table: stronger separation, but unnecessary complexity for one user-bound record shape.
- Dashboard DB storage: rejected because it splits authority away from the Medusa account.

### Gate codex-lb session activation after email/password login
Keep the existing `/auth/user/emailpass` login to obtain a candidate bearer token, then call custom Medusa admin routes to determine whether setup or verification is required. The frontend only stores/promotes the token after the second-factor requirement is satisfied.

**Alternatives considered:**
- Full custom auth provider replacing emailpass now: more complete, but significantly higher implementation and rollout cost.
- Frontend-only TOTP logic: rejected because secret verification must not live entirely in the browser.

### Reuse dashboard backend only for QR rendering
Add a small local QR-rendering endpoint in the Python dashboard backend that converts an otpauth URI into an SVG data URI. Medusa backend remains responsible for secret generation and verification; the dashboard backend is only a rendering utility so no third-party QR service sees the secret.

**Alternatives considered:**
- Third-party QR image service: rejected because it leaks shared-secret material.
- Adding a QR dependency to Medusa backend: rejected due to repo rule against new dependencies without explicit approval.

### Implement TOTP in Medusa backend with built-in crypto only
Implement RFC6238-compatible TOTP generation/verification with Node `crypto`, using a local helper for base32 secret generation, step verification, and replay prevention.

**Alternatives considered:**
- Add `otplib`/`speakeasy`: rejected due to no-new-dependencies rule.
- Proxy all verification to Python dashboard backend: rejected because Medusa should own second-factor validation for its account state.

## Risks / Trade-offs

- **[Metadata record drift]** → Mitigate with a versioned metadata shape and strict parsing/defaulting.
- **[Candidate token exists before 2FA completion]** → Mitigate by never persisting/promoting the token in codex-lb until verification succeeds; document that direct stock Medusa admin remains out of scope for this change.
- **[Cross-service QR dependency]** → Mitigate by keeping the QR endpoint stateless and narrow (otpauth URI in, SVG data URI out).
- **[Home-grown TOTP helper correctness]** → Mitigate with deterministic unit tests against known vectors and replay-window tests.

## Migration Plan

1. Add OpenSpec deltas and tests.
2. Add Medusa backend helpers/routes for status, setup, confirm, verify, disable.
3. Add QR rendering endpoint in dashboard backend.
4. Update frontend Medusa auth store/dialog/account menu for staged setup/challenge flows.
5. Run targeted backend/frontend tests plus `openspec validate --specs`.

Rollback: revert frontend flow and custom routes together; existing email/password Medusa admin login remains the fallback implementation path.

## Open Questions

- Whether a future follow-up should enforce 2FA for direct stock Medusa admin logins as well.
- Whether recovery codes should be added in a separate change.
