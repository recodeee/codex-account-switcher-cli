## Why
Operators requested that the dashboard stop rendering the embedded terminal UI and instead launch their operating system’s default terminal workflow when they click **Terminal** on an account card.

## What Changes
- Remove dashboard wiring that opens the in-app floating terminal workspace.
- Add a backend endpoint to switch the selected `codex-auth` snapshot and open a host terminal window.
- Rewire the dashboard terminal action to call the new endpoint.

## Impact
- No embedded terminal windows or pop-out terminal route usage from the dashboard.
- Terminal launch behavior becomes host-OS driven (Linux/macOS/Windows best-effort launcher).
- Existing account selection/snapshot switching safeguards remain in place.
