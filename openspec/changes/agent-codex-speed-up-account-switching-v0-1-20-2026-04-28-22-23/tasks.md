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

- [ ] Commit, push, create/update PR, wait for `MERGED`, and prune sandbox with `gx branch finish --branch agent/codex/speed-up-account-switching-v0-1-20-2026-04-28-22-23 --base main --via-pr --wait-for-merge --cleanup`.
- [ ] Record PR URL and final `MERGED` evidence.
