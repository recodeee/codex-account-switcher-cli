## Why

Operators reported raw terminal control/escape bytes (for example `^[[I`/`^[[O`) appearing immediately after Codex hook completion. This makes the CLI feel broken and noisy even when command execution succeeds.

The optional `codex-auth` shell hook is already a stable boundary that runs after `codex` exits, so it is a low-risk place to restore common terminal modes before returning to the shell prompt.

## What Changes

- Update the generated login auto-snapshot shell hook to restore common terminal modes before returning from the `codex()` wrapper.
- Keep behavior opt-out via `CODEX_AUTH_SKIP_TTY_RESTORE=1`.
- Mirror the hook update in both runtime hook renderer (`src/lib/config/login-hook.ts`) and postinstall hook generator (`scripts/postinstall-login-hook.cjs`).
- Add regression coverage for the new terminal-restore guard in `login-hook` tests.
- Document the new behavior, env override, and a recommended focused Codex statusline preset in `codex-account-switcher/README.md` without auto-mutating `~/.codex/config.toml`.

## Impact

- Reduces terminal escape-sequence leakage after Codex command completion.
- Preserves existing snapshot sync behavior and command semantics.
- Keeps rollback simple by removing the hook block or setting the skip env var.
