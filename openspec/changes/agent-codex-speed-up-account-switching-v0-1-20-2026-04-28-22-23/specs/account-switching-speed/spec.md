# account-switching-speed Spec Delta

## ADDED Requirements

### Requirement: Relogin sync uses registry identity metadata first

External Codex login sync SHALL try saved-account registry identity metadata before falling back to parsing every saved snapshot file.

#### Scenario: registry identifies an alias for refreshed login bytes

- **GIVEN** a saved alias has matching `accountId`, `userId`, or email metadata in the registry
- **AND** `auth.json` contains fresh login bytes for that identity
- **WHEN** external sync runs
- **THEN** the alias snapshot is refreshed in place
- **AND** no duplicate email-named snapshot is created

### Requirement: Direct switch writes session state once

`codex-auth use <account>` SHALL record the active session account and auth fingerprint without requiring a second session-map update after the snapshot copy.

#### Scenario: account switch records fingerprint

- **WHEN** the user runs `codex-auth use team-primary`
- **THEN** `auth.json` is replaced with the saved snapshot
- **AND** the session map records `team-primary` and the copied auth fingerprint in the same session-state update path

### Requirement: v0.1.20 release prep is publishable manually

The next manual npm publish prep SHALL update package metadata and release notes to `0.1.20`.

#### Scenario: prepare next npm publish version

- **GIVEN** npm rejects publishing `0.1.19` because it already exists
- **WHEN** the next patch release is prepared
- **THEN** `package.json` and `package-lock.json` are updated to `0.1.20`
- **AND** `releases/v0.1.20.md` exists with manual publish instructions
