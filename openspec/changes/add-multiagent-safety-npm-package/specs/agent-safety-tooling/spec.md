## ADDED Requirements

### Requirement: Multi-agent safety installer provisions collaboration guardrails
The `multiagent-safety` CLI SHALL install reusable multi-agent collaboration guardrails into a target git repository.

#### Scenario: Install command provisions scripts and hooks
- **WHEN** `multiagent-safety install --target <repo>` is run inside a valid git repository
- **THEN** it writes `scripts/agent-branch-start.sh`, `scripts/agent-branch-finish.sh`, `scripts/agent-file-locks.py`, and `.githooks/pre-commit`
- **AND** it initializes `.omx/state/agent-file-locks.json` when missing
- **AND** it sets `git config core.hooksPath .githooks`.

### Requirement: Installer updates project metadata without duplicate AGENTS blocks
The installer SHALL update local project metadata needed for workflow adoption while remaining idempotent.

#### Scenario: Install command updates package scripts and AGENTS snippet once
- **WHEN** `multiagent-safety install` runs on a repository containing `package.json` and `AGENTS.md`
- **THEN** agent workflow npm scripts are added/updated in `package.json`
- **AND** the multi-agent contract snippet is present in `AGENTS.md`
- **AND** rerunning install does not duplicate the snippet block.
