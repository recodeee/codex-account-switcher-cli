### ADDED Requirement: Dashboard terminal action opens host OS terminal flow
The dashboard account-card `Terminal` action SHALL request backend terminal launch instead of opening an embedded in-app terminal workspace.

#### Scenario: Terminal action launches host terminal workflow
- **WHEN** an operator clicks `Terminal` on an eligible account card
- **THEN** the frontend calls `POST /api/accounts/{accountId}/open-terminal`
- **AND** the backend switches to the account snapshot and attempts to open a host terminal window.

#### Scenario: Host terminal launch failure is surfaced
- **WHEN** `POST /api/accounts/{accountId}/open-terminal` fails to launch the host terminal
- **THEN** the API returns `400` with error code `terminal_launch_failed`
- **AND** the frontend shows an error toast instead of rendering an embedded terminal window.
