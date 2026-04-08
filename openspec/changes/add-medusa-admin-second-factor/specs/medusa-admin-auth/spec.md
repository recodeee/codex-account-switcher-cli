## ADDED Requirements

### Requirement: Medusa admin accounts can enroll a mobile authenticator
The system SHALL allow an authenticated Medusa admin user to start second-factor enrollment for their Medusa account, receive a TOTP secret plus otpauth URI, render a local QR code, and confirm setup with a valid 6-digit TOTP code before the account is marked as second-factor enabled.

#### Scenario: Start second-factor enrollment
- **WHEN** an authenticated Medusa admin user starts second-factor setup from codex-lb
- **THEN** the system returns a newly generated TOTP secret and otpauth URI for that Medusa admin account
- **AND** the QR image used in the UI is generated locally rather than via a third-party service
- **AND** the account is not marked enabled until confirmation succeeds

#### Scenario: Confirm second-factor enrollment
- **WHEN** the authenticated Medusa admin submits a valid TOTP code for the generated secret
- **THEN** the system stores second-factor state on that Medusa admin account
- **AND** the stored state includes replay protection for previously used verification steps
- **AND** the account is marked as second-factor enabled

### Requirement: Medusa admin login requires second-factor verification when enabled
The system SHALL require codex-lb Medusa admin sign-in to complete a second-factor challenge before the Medusa bearer token is promoted to active frontend session state whenever the Medusa admin account has second-factor enabled.

#### Scenario: Account without second factor
- **WHEN** a Medusa admin signs in with email and password and second factor is not enabled on the account
- **THEN** the frontend may promote the returned bearer token immediately

#### Scenario: Account with second factor enabled
- **WHEN** a Medusa admin signs in with email and password and second factor is enabled on the account
- **THEN** the frontend shows a 6-digit authenticator challenge before treating the Medusa session as active
- **AND** the bearer token is not persisted as active session state until the challenge succeeds

#### Scenario: Invalid or replayed TOTP code
- **WHEN** a Medusa admin submits an invalid or replayed TOTP code during login verification
- **THEN** the system rejects the verification attempt
- **AND** the Medusa admin session remains inactive in codex-lb

### Requirement: Medusa admin accounts can inspect and disable second factor
The system SHALL allow an authenticated and already verified Medusa admin user to inspect whether second factor is enabled and disable it by re-entering a valid TOTP code.

#### Scenario: Disable second factor
- **WHEN** an authenticated Medusa admin with second factor enabled submits a valid current TOTP code to disable it
- **THEN** the system clears the stored second-factor secret and replay state from the Medusa admin account
- **AND** subsequent email/password logins no longer require second-factor verification
