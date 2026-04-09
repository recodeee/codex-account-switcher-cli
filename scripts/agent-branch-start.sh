#!/usr/bin/env bash
set -euo pipefail

TASK_NAME="${1:-task}"
AGENT_NAME="${2:-agent}"
BASE_BRANCH="${3:-dev}"

sanitize_slug() {
  local raw="$1"
  local slug
  slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$slug" ]]; then
    slug="task"
  fi
  printf '%s' "$slug"
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-branch-start] Not inside a git repository." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[agent-branch-start] Working tree is not clean. Commit/stash changes before starting a new agent branch." >&2
  exit 1
fi

if git show-ref --verify --quiet "refs/remotes/origin/${BASE_BRANCH}"; then
  git fetch origin "${BASE_BRANCH}" --quiet
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BASE_BRANCH" ]]; then
  git checkout "$BASE_BRANCH"
fi

if git show-ref --verify --quiet "refs/remotes/origin/${BASE_BRANCH}"; then
  git pull --ff-only origin "$BASE_BRANCH"
fi

task_slug="$(sanitize_slug "$TASK_NAME")"
agent_slug="$(sanitize_slug "$AGENT_NAME")"
timestamp="$(date +%Y%m%d-%H%M%S)"
branch_name="agent/${agent_slug}/${timestamp}-${task_slug}"

git checkout -b "$branch_name"

echo "[agent-branch-start] Created branch: ${branch_name}"
echo "$branch_name"
