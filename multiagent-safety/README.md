# multiagent-safety

`multiagent-safety` is a global npm CLI that installs the same multi-agent guardrails used in this repo:

- protected-branch pre-commit guard (`.githooks/pre-commit`)
- agent branch lifecycle scripts (`scripts/agent-branch-start.sh`, `scripts/agent-branch-finish.sh`)
- per-file lock registry (`scripts/agent-file-locks.py`)
- optional AGENTS.md multi-agent contract snippet
- git hooks path setup (`core.hooksPath=.githooks`)

## Install globally

```bash
npm i -g multiagent-safety
```

## Apply to any repo

```bash
cd /path/to/your/repo
multiagent-safety install
```

## Command options

```bash
multiagent-safety install [--target <path>] [--force] [--skip-agents] [--skip-package-json] [--dry-run]
```

- `--target <path>`: install into another repo path
- `--force`: overwrite existing managed files
- `--skip-agents`: do not create/update `AGENTS.md`
- `--skip-package-json`: do not add npm script entries
- `--dry-run`: print what would happen

## What gets added

```text
scripts/agent-branch-start.sh
scripts/agent-branch-finish.sh
scripts/agent-file-locks.py
scripts/install-agent-git-hooks.sh
.githooks/pre-commit
.omx/state/agent-file-locks.json
```

And these scripts are added to `package.json` (if present):

- `agent:branch:start`
- `agent:branch:finish`
- `agent:hooks:install`
- `agent:locks:claim`
- `agent:locks:release`
- `agent:locks:status`

## Quick usage in installed repo

```bash
# start an isolated branch/worktree
bash scripts/agent-branch-start.sh "my-task" "agent-name"

# claim ownership for changed files
python3 scripts/agent-file-locks.py claim --branch "$(git rev-parse --abbrev-ref HEAD)" path/to/file

# merge branch safely back to dev
bash scripts/agent-branch-finish.sh --branch "$(git rev-parse --abbrev-ref HEAD)"
```
