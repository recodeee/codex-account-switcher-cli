## Why

Operators can already sign in to Medusa admin from the codex-lb account menu, but that flow currently stops at email/password. They now need the same account menu flow to support a second mobile authenticator factor with QR enrollment tied to the Medusa admin account.

## What Changes

- Add Medusa-admin second-factor enrollment, verification, and disable flows tied to the authenticated Medusa admin user.
- Add a QR-based setup experience in the codex-lb Medusa admin dialog flow, followed by 6-digit TOTP verification.
- Require codex-lb to gate Medusa admin session activation on second-factor verification when the Medusa admin account has second factor enabled.
- Add backend support in the Medusa service for storing second-factor state on the admin user and verifying TOTP challenges.
- Add a local QR-rendering utility in the dashboard backend so setup does not leak shared secrets to a third-party QR service.

## Capabilities

### New Capabilities
- `medusa-admin-auth`: Managing Medusa admin second-factor enrollment, verification, and account-bound TOTP state for codex-lb Medusa sign-in.

### Modified Capabilities
- `frontend-architecture`: The global shell account menu Medusa admin auth flow now includes second-factor challenge/setup states and Medusa 2FA management affordances.

## Impact

- Code: `apps/backend/src/api/admin/**`, `apps/backend/src/**/medusa-admin-*`, `apps/frontend/src/features/medusa-auth/*`, `apps/frontend/src/components/layout/account-menu.tsx`, `app/modules/dashboard_auth/*` or equivalent QR utility route.
- APIs: new Medusa admin 2FA endpoints and a local QR rendering helper endpoint.
- Systems: Medusa backend admin user metadata, codex-lb frontend account menu/login dialog, dashboard backend utility surface.
