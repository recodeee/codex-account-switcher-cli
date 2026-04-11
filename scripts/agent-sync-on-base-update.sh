#!/usr/bin/env bash
set -euo pipefail

BASE_BRANCH=""
CHECK_ONLY=0
QUIET=0
FORCE_RUN=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --check)
      CHECK_ONLY=1
      shift
      ;;
    --quiet)
      QUIET=1
      shift
      ;;
    --force)
      FORCE_RUN=1
      shift
      ;;
    *)
      echo "[agent-sync-all] Unknown argument: $1" >&2
      echo "Usage: $0 [--base <branch>] [--check] [--quiet] [--force]" >&2
      exit 1
      ;;
  esac
done

log() {
  if [[ "$QUIET" -eq 0 ]]; then
    echo "$@"
  fi
}

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  log "[agent-sync-all] Not inside a git repository; skipping."
  exit 0
fi

if ! command -v musafety >/dev/null 2>&1; then
  log "[agent-sync-all] musafety command not found; skipping auto-sync."
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
current_wt="$(pwd -P)"
current_branch="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"

if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(git -C "$repo_root" config --get multiagent.baseBranch || true)"
fi
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="dev"
fi

if [[ "$FORCE_RUN" -ne 1 && "$current_branch" != "$BASE_BRANCH" ]]; then
  log "[agent-sync-all] Current branch is '$current_branch' (base: '$BASE_BRANCH'); skipping."
  exit 0
fi

mode_label="sync"
sync_args=(sync --base "$BASE_BRANCH")
if [[ "$CHECK_ONLY" -eq 1 ]]; then
  mode_label="check"
  sync_args=(sync --check --base "$BASE_BRANCH")
fi

synced=0
skipped=0
failed=0

worktree_path=""
branch_ref=""
while IFS= read -r line; do
  if [[ "$line" == worktree\ * ]]; then
    worktree_path="${line#worktree }"
    branch_ref=""
    continue
  fi

  if [[ "$line" == branch\ * ]]; then
    branch_ref="${line#branch }"

    if [[ "$branch_ref" != refs/heads/agent/* ]]; then
      continue
    fi

    if [[ -z "$worktree_path" || ! -d "$worktree_path" ]]; then
      skipped=$((skipped + 1))
      continue
    fi

    if [[ "$worktree_path" == "$current_wt" ]]; then
      skipped=$((skipped + 1))
      continue
    fi

    if ! git -C "$worktree_path" diff --quiet --ignore-submodules -- . || ! git -C "$worktree_path" diff --cached --quiet --ignore-submodules -- .; then
      log "[agent-sync-all] Skip dirty worktree: $worktree_path"
      skipped=$((skipped + 1))
      continue
    fi

    if (cd "$worktree_path" && musafety "${sync_args[@]}" >/tmp/agent-sync-all.$$.$synced.log 2>&1); then
      log "[agent-sync-all] ${mode_label} ok: ${branch_ref#refs/heads/}"
      synced=$((synced + 1))
    else
      failed=$((failed + 1))
      log "[agent-sync-all] ${mode_label} failed: ${branch_ref#refs/heads/}"
      if [[ "$QUIET" -eq 0 ]]; then
        sed 's/^/[agent-sync-all]   /' "/tmp/agent-sync-all.$$.$synced.log" || true
      fi
    fi

    rm -f "/tmp/agent-sync-all.$$.$synced.log" || true
  fi
done < <(git -C "$repo_root" worktree list --porcelain)

log "[agent-sync-all] Completed: ${synced} updated, ${skipped} skipped, ${failed} failed."
exit 0
