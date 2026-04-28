# Tasks

## 1. Spec

- [x] Define registry-guided relogin matching and v0.1.20 release prep behavior.

## 2. Tests

- [x] Add regression coverage for registry-guided alias refresh.
- [x] Run `npm test --silent`.
- [x] Run `npm pack --dry-run`.

## 3. Implementation

- [x] Use registry metadata before saved snapshot parsing during external login sync.
- [x] Collapse direct account switch session-state updates.
- [x] Bump package metadata to `0.1.20`.
- [x] Add `releases/v0.1.20.md`.

## 4. Verification

- [x] Run `openspec validate agent-codex-speed-up-account-switching-v0-1-20-2026-04-28-22-23 --strict`.

## 5. Cleanup

- [x] Commit, push, create/update PR, wait for `MERGED`, and prune sandbox with `gx branch finish --branch agent/codex/speed-up-account-switching-v0-1-20-2026-04-28-22-23 --base main --via-pr --wait-for-merge --cleanup`.
- [x] Record PR URL and final `MERGED` evidence: https://github.com/recodeee/codex-account-switcher-cli/pull/17, state `MERGED`, merge commit `359dbc3dd9bb1f02a7b420dca953697d7f455218`, merged at `2026-04-28T20:30:48Z`; source branch and remote removed by `gx branch finish`, detached sandbox pruned by `gx cleanup --base main`.
