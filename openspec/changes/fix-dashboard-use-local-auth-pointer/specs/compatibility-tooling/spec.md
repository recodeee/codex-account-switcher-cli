## ADDED Requirements

### Requirement: Dashboard local switch keeps a host-valid auth pointer

When dashboard local account switching executes `codex-auth use <snapshot>`, the system SHALL verify that `CODEX_AUTH_JSON_PATH` resolves to the selected snapshot file under `CODEX_AUTH_ACCOUNTS_DIR`.
If the pointer is missing, broken, or not aligned with the selected snapshot, the system SHALL repair `CODEX_AUTH_CURRENT_PATH` and `CODEX_AUTH_JSON_PATH` to match the selected snapshot.

#### Scenario: Successful CLI switch with broken pointer is repaired

- **WHEN** `codex-auth use <snapshot>` exits successfully
- **AND** `auth.json` resolves to a missing or mismatched path
- **THEN** the backend rewrites `current` to `<snapshot>`
- **AND** rewrites `auth.json` to point to `<accounts_dir>/<snapshot>.json`
- **AND** the switch API still returns success

#### Scenario: Repaired pointer survives host/container path differences

- **WHEN** backend runs in a different filesystem prefix than the host terminal (for example container `/home/app` vs host `/home/deadpool`)
- **THEN** repaired `auth.json` uses a relative symlink target under the local `.codex` directory
- **AND** host-side `codex login status` can resolve the selected snapshot without `os error 2`

#### Scenario: Compose runtime allows pointer rewrites

- **WHEN** dashboard local account switching is used in Docker runtime/deploy compose configurations
- **THEN** the `.codex` bind mount for the server container is writable (`:rw`)
- **AND** switch operations can persist repaired `current` and `auth.json` pointers
