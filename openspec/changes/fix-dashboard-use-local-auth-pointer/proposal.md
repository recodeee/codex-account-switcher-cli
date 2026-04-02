## Why

Dashboard **Use this account** can leave `~/.codex/auth.json` pointing to a runtime-specific absolute path (for example `/home/app/.codex/...`) when codex-lb runs in a container.
That path is valid in the container but invalid on the host terminal, which later breaks `codex login` with `persist_failed` and `os error 2`.

## What Changes

- Harden backend local account switching to verify the active auth pointer after `codex-auth use`.
- If the pointer is missing, broken, or points to the wrong snapshot, repair it by writing canonical local pointers (`current` + `auth.json`) directly.
- Write `auth.json` symlink targets as relative paths so they remain valid across host/container path differences.
- Enforce writable `.codex` bind mounts in runtime/deploy compose configs used by dashboard switching.

## Impact

- Clicking **Use this account** keeps host Codex credentials usable.
- Existing `codex-auth` CLI switching remains the first path when available.
- Broken pointers from previous switches are self-healed on next switch.
