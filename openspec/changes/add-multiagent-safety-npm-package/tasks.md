## 1. Specification

- [x] 1.1 Add OpenSpec change `add-multiagent-safety-npm-package`.
- [x] 1.2 Define installer behavior for scripts/hooks provisioning, AGENTS snippet insertion, and git hooks path configuration.

## 2. Implementation

- [x] 2.1 Scaffold `multiagent-safety` npm package with CLI entrypoint and templates.
- [x] 2.2 Implement `install` command with `--target`, `--force`, `--dry-run`, `--skip-agents`, and `--skip-package-json` flags.
- [x] 2.3 Ensure installer sets executable permissions and initializes `.omx/state/agent-file-locks.json`.
- [x] 2.4 Add automated test coverage for install flow and idempotent rerun behavior.

## 3. Verification

- [x] 3.1 Run `node --test multiagent-safety/test/*.test.js`.
- [x] 3.2 Run `openspec validate add-multiagent-safety-npm-package --type change --strict`.
- [x] 3.3 Run `openspec validate --specs`.
