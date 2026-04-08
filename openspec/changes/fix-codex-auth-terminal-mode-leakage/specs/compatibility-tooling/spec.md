## ADDED Requirements

### Requirement: codex-auth login shell hook restores terminal mode before returning

When the optional login auto-snapshot shell hook wraps `codex`, it SHALL restore common terminal input/output modes before returning control to the shell prompt.

#### Scenario: Terminal modes restored after codex wrapper execution

- **WHEN** the hook-generated `codex()` wrapper finishes any invocation
- **THEN** the wrapper restores common terminal modes (focus reporting, application cursor mode, bracketed paste, mouse tracking, alternate screen)
- **AND** this restoration runs even when no snapshot sync action is needed.

#### Scenario: Terminal mode restoration can be disabled explicitly

- **WHEN** `CODEX_AUTH_SKIP_TTY_RESTORE=1` is set
- **THEN** the wrapper skips terminal mode restoration
- **AND** existing login snapshot sync behavior remains unchanged.

### Requirement: codex-auth README recommends a focused Codex statusline preset

The `codex-account-switcher` README SHALL document an optional focused Codex statusline preset for a calmer CLI footer and SHALL make clear that the package does not rewrite `~/.codex/config.toml` automatically.

#### Scenario: README gives a calmer footer recommendation without mutating config

- **WHEN** an operator reads the install or hook guidance in the README
- **THEN** the docs mention a focused `[tui] status_line` preset recommendation
- **AND** the docs state that the preset is optional and user-managed
- **AND** the docs do not instruct the package to auto-edit global Codex config.
