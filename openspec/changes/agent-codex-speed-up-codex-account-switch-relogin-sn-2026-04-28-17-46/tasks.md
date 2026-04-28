# Tasks

## 1. Spec

- [x] Define account-switch fast path and relogin snapshot refresh behavior.

## 2. Tests

- [x] Add regression tests for same-account relogin token refresh.
- [x] Add regression tests for alias-preserving relogin sync.
- [x] Add regression tests for session fingerprint refresh after `useAccount`.

## 3. Implementation

- [x] Make `codex-auth use` skip pre-run external sync.
- [x] Update `useAccount` to avoid full registry reconciliation for the switch hot path.
- [x] Make external relogin sync refresh matching saved snapshots, including aliases.

## 4. Verification

- [x] Run `npm test --silent`.
- [x] Run `openspec validate agent-codex-speed-up-codex-account-switch-relogin-sn-2026-04-28-17-46 --strict`.

## 5. Cleanup

- [x] Commit, push, create/update PR, wait for `MERGED`, and prune sandbox with `gx branch finish --branch agent/codex/speed-up-codex-account-switch-relogin-sn-2026-04-28-17-46 --base main --via-pr --wait-for-merge --cleanup`.
- [x] Record PR URL and final `MERGED` evidence: https://github.com/recodeee/codex-account-switcher-cli/pull/15, state `MERGED`, merge commit `def0465900021513d5bcd50bce5b60a4baf895d1`, merged at `2026-04-28T15:57:58Z`; sandbox pruned by `gx cleanup --base main`.
