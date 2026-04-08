## 1. Implementation

- [x] 1.1 Update login hook block renderer to include terminal-mode restore helper and opt-out env gate.
- [x] 1.2 Update postinstall hook script renderer with the same terminal-mode restore logic.
- [x] 1.3 Add login-hook regression test asserting terminal-mode restore guard is emitted.
- [x] 1.4 Update `codex-account-switcher/README.md` with behavior + opt-out env variable.
- [x] 1.5 Add README guidance for a focused Codex `[tui] status_line` preset and note that it remains user-managed.

## 2. Verification

- [x] 2.1 Run `cd codex-account-switcher && npm test --silent`.
- [x] 2.2 Run `openspec validate --specs`.
