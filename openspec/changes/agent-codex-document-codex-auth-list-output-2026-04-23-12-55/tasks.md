## 1. Spec

- [x] 1.1 Define the README requirement for showing account-name-first `codex-auth list` output

## 2. Tests

- [x] 2.1 Re-run package verification after the documentation change

## 3. Implementation

- [x] 3.1 Add a short `codex-auth list` output example to `README.md`
- [x] 3.2 Clarify that the active row is marked with `*`

## 4. Checkpoints

- [x] 4.1 Confirm package tests still pass

## 5. Cleanup

- [x] 5.1 Validate the change with `openspec validate agent-codex-document-codex-auth-list-output-2026-04-23-12-55 --type change --strict`
- [ ] 5.2 Finish with `gx branch finish --branch "agent/codex/document-codex-auth-list-output-2026-04-23-12-55" --base main --via-pr --wait-for-merge --cleanup`
- [ ] 5.3 Record PR URL and final `MERGED` evidence
