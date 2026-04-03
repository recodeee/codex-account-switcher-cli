## Why
The current in-app terminal is a modal locked to the dashboard viewport. Operators asked for a desktop-like terminal workflow: move windows freely inside the app, collapse terminals into a side rail, and detach a terminal into a real browser window that can be moved anywhere on the desktop.

## What Changes
- Replace dashboard terminal modal usage with a global terminal workspace available across app pages.
- Add draggable floating terminal windows with terminal-style chrome.
- Add minimize-to-dock behavior with a left-side terminal list for open sessions.
- Add detached terminal pop-out route (`/terminal-popout`) and pop-out action from each in-app terminal window.
- Reuse in-app sessions per account (single in-app terminal per account), and close in-app session when popped out.

## Impact
- Better operator ergonomics for multi-account terminal workflows.
- No backend websocket contract changes required.
- Route surface adds one new frontend page (`/terminal-popout`).
