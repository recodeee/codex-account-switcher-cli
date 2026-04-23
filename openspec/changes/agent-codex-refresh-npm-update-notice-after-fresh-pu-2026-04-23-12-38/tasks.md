## 1. Spec

- [x] 1.1 Define fresh-publish update-detection behavior for stale "up-to-date" cache entries

## 2. Tests

- [x] 2.1 Add a regression that refreshes a stale negative cache quickly
- [x] 2.2 Keep coverage proving update-available cache entries can still reuse the long TTL

## 3. Implementation

- [x] 3.1 Split cache reuse policy between "up-to-date" and "update-available" results
- [x] 3.2 Pass the current installed version into cached update checks from interactive entrypoints

## 4. Checkpoints

- [x] 4.1 Run focused package verification
- [x] 4.2 Validate the publish-gap reproduction against the new cache policy

## 5. Cleanup

- [x] 5.1 Validate the change with `openspec validate agent-codex-refresh-npm-update-notice-after-fresh-pu-2026-04-23-12-38 --type change --strict`
- [ ] 5.2 Finish with `gx branch finish --branch "agent/codex/refresh-npm-update-notice-after-fresh-pu-2026-04-23-12-38" --base main --via-pr --wait-for-merge --cleanup`
- [ ] 5.3 Record PR URL and final `MERGED` evidence
