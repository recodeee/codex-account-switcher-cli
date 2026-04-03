### CHANGED Requirement: Dashboard account card can launch an in-app Codex terminal
The Dashboard account-card terminal action SHALL open an in-app terminal that behaves like a persistent interactive shell and auto-runs the configured startup command.

#### Scenario: Terminal session auto-runs startup command and remains interactive
- **WHEN** the backend accepts `/api/accounts/{accountId}/terminal/ws` and starts a terminal session
- **THEN** it starts an interactive login shell attached to PTY
- **AND** it sends startup input that changes to configured terminal working directory and runs the configured startup command
- **AND** the session remains open for additional user input until the user exits the shell or closes the dialog.

#### Scenario: Startup command failure does not force immediate session exit
- **WHEN** the startup command is unavailable or fails (for example `command not found`)
- **THEN** terminal output shows the shell error
- **AND** the shell remains interactive so the user can run recovery commands in the same session.

#### Scenario: Terminal dialog uses terminal-style dark chrome
- **WHEN** an operator opens the terminal dialog from an account card
- **THEN** the dialog renders terminal-style window chrome and a dark terminal viewport
- **AND** the terminal host remains resizable and connected to the same websocket session.
