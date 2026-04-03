### CHANGED Requirement: Dashboard terminal action opens host OS terminal flow
The dashboard account-card `Terminal` action SHALL attempt backend host-terminal launch first, and SHALL fallback to opening the in-app terminal workspace when host launch fails with `terminal_launch_failed`.

#### Scenario: Terminal action launches host terminal workflow
- **WHEN** an operator clicks `Terminal` on an eligible account card
- **THEN** the frontend calls `POST /api/accounts/{accountId}/open-terminal`
- **AND** on success the frontend does NOT open an in-app terminal window.

#### Scenario: Host terminal launch failure falls back to in-app terminal
- **WHEN** `POST /api/accounts/{accountId}/open-terminal` fails with `400` and `error.code = terminal_launch_failed`
- **THEN** the frontend opens an in-app terminal workspace window for that account
- **AND** the user sees an informational fallback toast.
