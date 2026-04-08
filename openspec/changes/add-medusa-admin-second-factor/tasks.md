## 1. Spec

- [ ] 1.1 Add Medusa admin second-factor capability spec and frontend-architecture delta.
- [ ] 1.2 Validate OpenSpec changes (`openspec validate --specs`).

## 2. Tests

- [ ] 2.1 Add Medusa backend unit tests for TOTP helper logic (generation/verification/replay).
- [ ] 2.2 Add Medusa backend route tests for second-factor status/setup/verify/disable responses.
- [ ] 2.3 Add frontend schema/store tests for staged Medusa admin second-factor login state.
- [ ] 2.4 Add frontend dialog/component tests for QR setup and TOTP challenge flows.

## 3. Implementation

- [ ] 3.1 Add Medusa backend second-factor helpers and authenticated admin routes using Medusa user metadata.
- [ ] 3.2 Add local QR-rendering utility endpoint in the dashboard backend.
- [ ] 3.3 Extend frontend Medusa admin auth API/store/dialog/account-menu flow for setup, verify, and disable actions.
- [ ] 3.4 Persist Medusa admin token only after second-factor verification when required.

## 4. Verification

- [ ] 4.1 Run targeted backend/frontend test commands covering Medusa admin 2FA.
- [ ] 4.2 Run `openspec validate --specs` and record any remaining risks.
