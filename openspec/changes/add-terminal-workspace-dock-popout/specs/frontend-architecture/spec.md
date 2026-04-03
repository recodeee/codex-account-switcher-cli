## MODIFIED Requirements
### Requirement: Dashboard account card can launch an in-app Codex terminal
The Dashboard account-card terminal action SHALL open (or focus) a reusable terminal workspace window for the selected account instead of creating route-local modal state.

#### Scenario: Reuse existing in-app terminal per account
- **WHEN** the operator triggers `Terminal` for an account that already has an in-app terminal window
- **THEN** the existing window is restored/focused
- **AND** a duplicate in-app terminal window for that account is NOT created.

#### Scenario: Terminal windows persist across app routes
- **WHEN** an operator opens a terminal window and navigates to another page in the authenticated app shell
- **THEN** the in-app terminal session remains available and docked/window state is preserved.

### Requirement: In-app terminal workspace supports minimize and side dock
The app SHALL provide a terminal dock rail that lists open terminal sessions and allows minimized terminals to be restored.

#### Scenario: Minimize keeps session alive
- **WHEN** an operator minimizes an open in-app terminal window
- **THEN** the terminal appears in the dock list
- **AND** the terminal session remains connected/running until explicitly closed.

#### Scenario: Restore from dock
- **WHEN** an operator selects a minimized terminal in the dock
- **THEN** the matching terminal window is restored and focused.

### Requirement: Detached terminal pop-out route
The frontend SHALL support a detached terminal route (`/terminal-popout`) used by the in-app pop-out action.

#### Scenario: Pop-out opens detached terminal window
- **WHEN** an operator clicks pop-out on an in-app terminal window
- **THEN** the app opens a new browser window pointing to `/terminal-popout` with account identity query params
- **AND** the in-app terminal session is closed after successful pop-out.

#### Scenario: Missing pop-out account context
- **WHEN** `/terminal-popout` is loaded without an `accountId`
- **THEN** the page renders a non-crashing fallback message instructing the operator to reopen from dashboard.
