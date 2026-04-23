## 1. Spec

- [x] 1.1 Define the release-prep requirement for the next publishable patch version

## 2. Tests

- [x] 2.1 Re-run package verification after the version bump
- [x] 2.2 Re-run `npm pack --dry-run` to prove publishable contents

## 3. Implementation

- [x] 3.1 Bump package metadata to `0.1.19`
- [x] 3.2 Add `releases/v0.1.19.md`

## 4. Checkpoints

- [x] 4.1 Confirm package tests still pass
- [x] 4.2 Confirm dry-run pack succeeds

## 5. Cleanup

- [x] 5.1 Validate the change with `openspec validate agent-codex-prepare-v0-1-19-release-2026-04-23-12-49 --type change --strict`
- [ ] 5.2 Finish with `gx branch finish --branch "agent/codex/prepare-v0-1-19-release-2026-04-23-12-49" --base main --via-pr --wait-for-merge --cleanup`
- [ ] 5.3 Record PR URL and final `MERGED` evidence
