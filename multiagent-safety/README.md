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

## Apply to one repo

```bash
cd /path/to/your/repo
multiagent-safety install
```

## Apply to many repos in a workspace

```bash
# easiest: run from workspace root (auto-scans current folder at depth 2)
cd ~/projects
multiagent-safety install-many

# explicit workspace root
multiagent-safety install-many --workspace ~/projects --max-depth 2

# explicit repo list (comma-separated)
multiagent-safety install-many --targets ~/repo-a,~/repo-b

# explicit repo list from file (newline or comma separated; # comments allowed)
multiagent-safety install-many --targets-file ./workspace-repos.txt
```

## Create a reusable workspace targets file

```bash
# generate once, then commit/share this file in your workspace tools repo
multiagent-safety init-workspace --workspace ~/projects

# apply guardrails from the generated list
multiagent-safety install-many --targets-file ~/projects/.multiagent-safety-targets.txt
```

## Verify setup health

```bash
# check current repo
multiagent-safety doctor

# check another repo
multiagent-safety doctor --target ~/projects/repo-a

# treat warnings as failures
multiagent-safety doctor --strict
```

## Command options

```bash
multiagent-safety install [--target <path>] [--force] [--skip-agents] [--skip-package-json] [--dry-run]
multiagent-safety install-many [--workspace <path>] [--max-depth <n>] [--target <path>] [--targets <a,b,c>] [--targets-file <file>] [--force] [--skip-agents] [--skip-package-json] [--dry-run] [--fail-fast]
multiagent-safety init-workspace [--workspace <path>] [--max-depth <n>] [--output <file>] [--force]
multiagent-safety doctor [--target <path>] [--strict]
```

Shared install flags:

- `--force`: overwrite existing managed files
- `--skip-agents`: do not create/update `AGENTS.md`
- `--skip-package-json`: do not add npm script entries
- `--dry-run`: print what would happen

`install-many` specific flags:

- `--workspace <path>`: recursively discover git repos under a workspace root
- `--max-depth <n>`: discovery depth for `--workspace` (default: `2`)
- `--target <path>`: add one explicit target (can be repeated)
- `--targets <a,b,c>`: add comma-separated explicit targets
- `--targets-file <file>`: load targets from file (`#` comments supported)
- `--fail-fast`: stop immediately after first failed target

`init-workspace` specific flags:

- `--workspace <path>`: scan this workspace (default: current directory)
- `--max-depth <n>`: discovery depth (default: `2`)
- `--output <file>`: output targets file path (default: `<workspace>/.multiagent-safety-targets.txt`)
- `--force`: overwrite existing targets file

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
