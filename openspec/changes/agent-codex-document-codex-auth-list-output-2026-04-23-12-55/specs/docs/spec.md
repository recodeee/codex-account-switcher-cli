## ADDED Requirements

### Requirement: README must show the default codex-auth list row shape

The README MUST show that the default `codex-auth list` output starts with the saved account/snapshot name, followed by the remaining `5h` and `weekly` values, and that the active row is marked with `*`.

#### Scenario: reading list docs

- **Given** a user is checking the README for `codex-auth list`
- **When** they read the usage section
- **Then** they see an example row with the account/snapshot name first
- **And** they can tell that `*` marks the active account
