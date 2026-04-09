#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH="dev"
SOURCE_BRANCH=""
PUSH_ENABLED=1
DELETE_REMOTE_BRANCH=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --branch)
      SOURCE_BRANCH="${2:-}"
      shift 2
      ;;
    --no-push)
      PUSH_ENABLED=0
      shift
      ;;
    --keep-remote-branch)
      DELETE_REMOTE_BRANCH=0
      shift
      ;;
    *)
      echo "[agent-branch-finish] Unknown argument: $1" >&2
      echo "Usage: $0 [--base <branch>] [--branch <branch>] [--no-push] [--keep-remote-branch]" >&2
      exit 1
      ;;
  esac
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-branch-finish] Not inside a git repository." >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[agent-branch-finish] Working tree is not clean. Commit/stash changes before finishing branch." >&2
  exit 1
fi

if [[ -z "$SOURCE_BRANCH" ]]; then
  SOURCE_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
fi

if [[ "$SOURCE_BRANCH" == "$BASE_BRANCH" ]]; then
  echo "[agent-branch-finish] Source branch and base branch are both '$BASE_BRANCH'." >&2
  echo "[agent-branch-finish] Switch to your agent branch or pass --branch <agent-branch>." >&2
  exit 1
fi

if ! git show-ref --verify --quiet "refs/heads/${SOURCE_BRANCH}"; then
  echo "[agent-branch-finish] Local source branch does not exist: ${SOURCE_BRANCH}" >&2
  exit 1
fi

current_branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$current_branch" != "$BASE_BRANCH" ]]; then
  git checkout "$BASE_BRANCH"
fi

if git show-ref --verify --quiet "refs/remotes/origin/${BASE_BRANCH}"; then
  git fetch origin "$BASE_BRANCH" --quiet
  git pull --ff-only origin "$BASE_BRANCH"
fi

if ! git merge --no-ff --no-edit "$SOURCE_BRANCH"; then
  echo "[agent-branch-finish] Merge conflict detected while merging '${SOURCE_BRANCH}' into '${BASE_BRANCH}'." >&2
  echo "[agent-branch-finish] Aborting merge to avoid leaving unmerged files in your working tree." >&2
  git merge --abort >/dev/null 2>&1 || true
  echo "[agent-branch-finish] Resolve conflicts on '${SOURCE_BRANCH}' first (e.g. rebase/merge '${BASE_BRANCH}' there), then re-run finish." >&2
  exit 1
fi

if [[ "$PUSH_ENABLED" -eq 1 ]]; then
  git push origin "$BASE_BRANCH"
fi

git branch -d "$SOURCE_BRANCH"

if [[ "$PUSH_ENABLED" -eq 1 && "$DELETE_REMOTE_BRANCH" -eq 1 ]]; then
  if git ls-remote --exit-code --heads origin "$SOURCE_BRANCH" >/dev/null 2>&1; then
    git push origin --delete "$SOURCE_BRANCH"
  fi
fi

echo "[agent-branch-finish] Merged '${SOURCE_BRANCH}' into '${BASE_BRANCH}' and removed branch."
