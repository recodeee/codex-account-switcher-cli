## Why

We need a reusable installer that ports this repository's multi-agent safety workflow (protected-branch guard, agent branch scripts, and file ownership locks) into other repositories with one command.

## What Changes

- Add a publishable npm CLI package `multiagent-safety`.
- Ship template scripts/hooks that mirror the current codex-lb multi-agent guardrails.
- Implement `multiagent-safety install` to copy scripts/hooks, initialize lock state, update `package.json` scripts, append an AGENTS contract snippet, and configure `core.hooksPath`.
- Add tests for installer idempotency and git config behavior.

## Impact

- Teams can install the same multi-agent safety baseline globally (`npm i -g multiagent-safety`) and apply it in other projects.
- Reduces accidental direct commits on protected branches and cross-agent file collisions in repos that adopt the package.
