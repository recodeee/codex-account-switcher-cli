## MODIFIED Requirements

### Requirement: Global layout and shell components
The application SHALL include a global shell with header/sidebar composition, and the header account menu SHALL expose account-level actions, route shortcuts, and authentication controls.

#### Scenario: Sign in Medusa admin with second factor enabled
- **WHEN** an authenticated dashboard user opens the account menu and signs in to a Medusa admin account that has second factor enabled
- **THEN** the app first collects Medusa admin email and password
- **AND** the app then shows either a QR setup step or a 6-digit authenticator challenge, depending on the account's second-factor status
- **AND** the account menu only shows the Medusa admin as signed in after the second-factor flow succeeds

#### Scenario: Manage Medusa admin second factor from account menu
- **WHEN** a Medusa admin is currently signed in through the account menu
- **THEN** the account menu exposes second-factor status for that Medusa admin account
- **AND** the user can open setup or disable actions without leaving the account menu flow
