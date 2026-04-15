#!/usr/bin/env bash
set -euo pipefail

INTERVAL_SECONDS="${MUSAFETY_AGENT_AUTOFINISH_INTERVAL_SECONDS:-45}"
IDLE_SECONDS="${MUSAFETY_AGENT_AUTOFINISH_IDLE_SECONDS:-900}"
BRANCH_PREFIX="${MUSAFETY_AGENT_AUTOFINISH_BRANCH_PREFIX:-agent/}"
BASE_BRANCH_OVERRIDE="${MUSAFETY_AGENT_AUTOFINISH_BASE_BRANCH:-}"
STATE_FILE="${MUSAFETY_AGENT_AUTOFINISH_STATE_FILE:-}"
PID_FILE="${MUSAFETY_AGENT_AUTOFINISH_PID_FILE:-}"
LOG_FILE="${MUSAFETY_AGENT_AUTOFINISH_LOG_FILE:-}"
RETRY_FAILED_RAW="${MUSAFETY_AGENT_AUTOFINISH_RETRY_FAILED:-false}"

DRY_RUN=0
ONCE=0
DAEMON=0
STOP_DAEMON=0
STATUS_DAEMON=0
RETRY_FAILED=0

usage() {
  cat <<'USAGE'
Usage: bash scripts/agent-autofinish-watch.sh [options]

Watch agent/* worktrees, auto-commit idle changes, push branches, and create/update PRs.

Options:
  --base <branch>           Default base branch for PRs (default: inferred, usually dev)
  --branch-prefix <prefix>  Branch prefix to watch (default: agent/)
  --interval <seconds>      Poll interval in seconds (default: 45)
  --idle-seconds <seconds>  Minimum file-idle time before auto-commit (default: 900)
  --state-file <path>       State file path (default: .omx/state/agent-autofinish-watch.tsv)
  --pid-file <path>         PID file path for daemon mode (default: .omx/state/agent-autofinish-watch.pid)
  --log-file <path>         Log file path for daemon mode (default: .omx/state/agent-autofinish-watch.log)
  --retry-failed            Retry previously failed unchanged signatures
  --dry-run                 Show actions without mutating git/PR state
  --once                    Run one cycle and exit
  --daemon                  Start watcher in background and exit
  --stop                    Stop background watcher (via pid file)
  --status                  Show background watcher status
  -h, --help                Show this help
USAGE
}

normalize_bool() {
  local raw="${1:-}"
  local fallback="${2:-0}"
  case "$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) printf '1' ;;
    0|false|no|off) printf '0' ;;
    '') printf '%s' "$fallback" ;;
    *) printf '%s' "$fallback" ;;
  esac
}

sanitize_slug() {
  local raw="$1"
  local fallback="$2"
  local slug
  slug="$(printf '%s' "$raw" | tr '[:upper:]' '[:lower:]' | sed -E 's/[^a-z0-9]+/-/g; s/^-+//; s/-+$//; s/-{2,}/-/g')"
  if [[ -z "$slug" ]]; then
    slug="$fallback"
  fi
  printf '%s' "$slug"
}

is_pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" && "$pid" =~ ^[0-9]+$ ]] || return 1
  kill -0 "$pid" >/dev/null 2>&1
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[agent-autofinish-watch] [dry-run] $*"
    return 0
  fi
  "$@"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      BASE_BRANCH_OVERRIDE="${2:-}"
      shift 2
      ;;
    --branch-prefix)
      BRANCH_PREFIX="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL_SECONDS="${2:-}"
      shift 2
      ;;
    --idle-seconds)
      IDLE_SECONDS="${2:-}"
      shift 2
      ;;
    --state-file)
      STATE_FILE="${2:-}"
      shift 2
      ;;
    --pid-file)
      PID_FILE="${2:-}"
      shift 2
      ;;
    --log-file)
      LOG_FILE="${2:-}"
      shift 2
      ;;
    --retry-failed)
      RETRY_FAILED=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --once)
      ONCE=1
      shift
      ;;
    --daemon)
      DAEMON=1
      shift
      ;;
    --stop)
      STOP_DAEMON=1
      shift
      ;;
    --status)
      STATUS_DAEMON=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[agent-autofinish-watch] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ "$RETRY_FAILED" -eq 0 ]]; then
  RETRY_FAILED="$(normalize_bool "$RETRY_FAILED_RAW" "0")"
fi

if [[ ! "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SECONDS" -lt 5 ]]; then
  echo "[agent-autofinish-watch] --interval must be an integer >= 5 seconds." >&2
  exit 1
fi
if [[ ! "$IDLE_SECONDS" =~ ^[0-9]+$ ]] || [[ "$IDLE_SECONDS" -lt 30 ]]; then
  echo "[agent-autofinish-watch] --idle-seconds must be an integer >= 30 seconds." >&2
  exit 1
fi
if [[ -z "$BRANCH_PREFIX" ]]; then
  echo "[agent-autofinish-watch] --branch-prefix must be non-empty." >&2
  exit 1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[agent-autofinish-watch] Not inside a git repository." >&2
  exit 1
fi
repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

for cmd in sha256sum stat; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[agent-autofinish-watch] Missing required command: $cmd" >&2
    exit 127
  fi
done

resolve_default_base_branch() {
  local configured current
  configured="$(git -C "$repo_root" config --get multiagent.baseBranch || true)"
  if [[ -n "$configured" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/heads/${configured}"; then
    printf '%s' "$configured"
    return 0
  fi
  current="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
  if [[ -n "$current" && "$current" != "HEAD" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/heads/${current}"; then
    printf '%s' "$current"
    return 0
  fi
  for fallback in dev main; do
    if git -C "$repo_root" show-ref --verify --quiet "refs/heads/${fallback}"; then
      printf '%s' "$fallback"
      return 0
    fi
  done
  printf '%s' "dev"
}

if [[ -z "$BASE_BRANCH_OVERRIDE" ]]; then
  BASE_BRANCH_OVERRIDE="$(resolve_default_base_branch)"
fi

base_slug="$(sanitize_slug "$BASE_BRANCH_OVERRIDE" "base")"
if [[ -z "$STATE_FILE" ]]; then
  STATE_FILE="$repo_root/.omx/state/agent-autofinish-watch-${base_slug}.tsv"
fi
if [[ -z "$PID_FILE" ]]; then
  PID_FILE="$repo_root/.omx/state/agent-autofinish-watch-${base_slug}.pid"
fi
if [[ -z "$LOG_FILE" ]]; then
  LOG_FILE="$repo_root/.omx/state/agent-autofinish-watch-${base_slug}.log"
fi
mkdir -p "$(dirname "$STATE_FILE")"
mkdir -p "$(dirname "$PID_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

if [[ "$STOP_DAEMON" -eq 1 ]]; then
  if [[ ! -f "$PID_FILE" ]]; then
    echo "[agent-autofinish-watch] No pid file: $PID_FILE"
    exit 0
  fi
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if ! is_pid_alive "$pid"; then
    echo "[agent-autofinish-watch] No running watcher for pid file: $PID_FILE"
    rm -f "$PID_FILE"
    exit 0
  fi
  kill "$pid" >/dev/null 2>&1 || true
  rm -f "$PID_FILE"
  echo "[agent-autofinish-watch] Stopped watcher pid $pid"
  exit 0
fi

if [[ "$STATUS_DAEMON" -eq 1 ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_pid_alive "$pid"; then
    echo "[agent-autofinish-watch] running pid=$pid"
    echo "[agent-autofinish-watch] log=$LOG_FILE"
    exit 0
  fi
  echo "[agent-autofinish-watch] not running"
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[agent-autofinish-watch] gh is not installed; continuing in --dry-run mode without PR API checks." >&2
  else
    echo "[agent-autofinish-watch] Missing required command: gh" >&2
    exit 127
  fi
elif ! gh auth status >/dev/null 2>&1; then
  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[agent-autofinish-watch] gh is not authenticated; continuing in --dry-run mode without PR API checks." >&2
  else
    echo "[agent-autofinish-watch] gh is not authenticated. Run: gh auth login" >&2
    exit 1
  fi
fi

if [[ "$DAEMON" -eq 1 ]]; then
  pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if is_pid_alive "$pid"; then
    echo "[agent-autofinish-watch] Already running pid=$pid"
    echo "[agent-autofinish-watch] log=$LOG_FILE"
    exit 0
  fi
  args=(
    --base "$BASE_BRANCH_OVERRIDE"
    --branch-prefix "$BRANCH_PREFIX"
    --interval "$INTERVAL_SECONDS"
    --idle-seconds "$IDLE_SECONDS"
    --state-file "$STATE_FILE"
    --pid-file "$PID_FILE"
    --log-file "$LOG_FILE"
  )
  if [[ "$RETRY_FAILED" -eq 1 ]]; then
    args+=(--retry-failed)
  fi
  if [[ "$DRY_RUN" -eq 1 ]]; then
    args+=(--dry-run)
  fi
  nohup bash "$0" "${args[@]}" >>"$LOG_FILE" 2>&1 &
  daemon_pid="$!"
  printf '%s\n' "$daemon_pid" > "$PID_FILE"
  echo "[agent-autofinish-watch] Started watcher pid=$daemon_pid"
  echo "[agent-autofinish-watch] log=$LOG_FILE"
  exit 0
fi

declare -A LAST_SIGNATURE
declare -A LAST_STATUS

load_state() {
  if [[ ! -f "$STATE_FILE" ]]; then
    return 0
  fi
  while IFS=$'\t' read -r branch signature status updated_at; do
    if [[ -z "${branch:-}" || "${branch:0:1}" == "#" ]]; then
      continue
    fi
    LAST_SIGNATURE["$branch"]="${signature:-}"
    LAST_STATUS["$branch"]="${status:-}"
  done < "$STATE_FILE"
}

save_state() {
  {
    echo "# branch\tsignature\tstatus\tupdated_at"
    for branch in "${!LAST_SIGNATURE[@]}"; do
      printf '%s\t%s\t%s\t%s\n' \
        "$branch" \
        "${LAST_SIGNATURE[$branch]}" \
        "${LAST_STATUS[$branch]}" \
        "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    done | sort
  } > "$STATE_FILE"
}

list_agent_worktrees() {
  git -C "$repo_root" worktree list --porcelain | awk '
    $1 == "worktree" { wt = $2 }
    $1 == "branch" {
      br = $2
      sub("^refs/heads/", "", br)
      print br "\t" wt
    }
  '
}

resolve_branch_base() {
  local branch="$1"
  local branch_base
  branch_base="$(git -C "$repo_root" config --get "branch.${branch}.musafetyBase" || true)"
  if [[ -n "$branch_base" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/heads/${branch_base}"; then
    printf '%s' "$branch_base"
    return 0
  fi
  if [[ -n "$BASE_BRANCH_OVERRIDE" ]] && git -C "$repo_root" show-ref --verify --quiet "refs/heads/${BASE_BRANCH_OVERRIDE}"; then
    printf '%s' "$BASE_BRANCH_OVERRIDE"
    return 0
  fi
  printf '%s' "$(resolve_default_base_branch)"
}

filtered_status() {
  local wt="$1"
  git -C "$wt" status --porcelain --untracked-files=normal -- \
    . \
    ":(exclude).omx/state/agent-file-locks.json" \
    ":(exclude).dev-ports.json" \
    ":(exclude)apps/logs/*.log"
}

status_path_from_line() {
  local line="$1"
  local path_part
  path_part="${line:3}"
  if [[ "$path_part" == *" -> "* ]]; then
    path_part="${path_part##* -> }"
  fi
  printf '%s' "$path_part"
}

status_latest_change_epoch() {
  local wt="$1"
  local status_output="$2"
  local now max_epoch
  now="$(date +%s)"
  max_epoch=0

  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    local rel_path full_path epoch
    rel_path="$(status_path_from_line "$line")"
    if [[ -z "$rel_path" ]]; then
      continue
    fi
    full_path="$wt/$rel_path"
    if [[ -e "$full_path" ]]; then
      epoch="$(stat -c %Y "$full_path" 2>/dev/null || stat -f %m "$full_path" 2>/dev/null || echo "$now")"
    else
      epoch="$now"
    fi
    if [[ "$epoch" =~ ^[0-9]+$ ]] && [[ "$epoch" -gt "$max_epoch" ]]; then
      max_epoch="$epoch"
    fi
  done <<< "$status_output"

  printf '%s' "$max_epoch"
}

claim_changed_files() {
  local branch="$1"
  local wt="$2"
  local status_output="$3"
  local -a files=()
  local rel_path
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    rel_path="$(status_path_from_line "$line")"
    if [[ -z "$rel_path" ]]; then
      continue
    fi
    files+=("$rel_path")
  done <<< "$status_output"

  if [[ "${#files[@]}" -eq 0 ]]; then
    return 0
  fi
  run_cmd python3 "$repo_root/scripts/agent-file-locks.py" claim --branch "$branch" "${files[@]}" >/dev/null
}

auto_commit_if_needed() {
  local branch="$1"
  local wt="$2"
  local status_output="$3"

  if [[ -z "$status_output" ]]; then
    return 0
  fi

  latest_change_epoch="$(status_latest_change_epoch "$wt" "$status_output")"
  now_epoch="$(date +%s)"
  if [[ "$latest_change_epoch" =~ ^[0-9]+$ ]] && [[ "$latest_change_epoch" -gt 0 ]]; then
    idle_for=$((now_epoch - latest_change_epoch))
    if [[ "$idle_for" -lt "$IDLE_SECONDS" ]]; then
      echo "[agent-autofinish-watch] ${branch}: dirty but idle ${idle_for}s < ${IDLE_SECONDS}s (waiting)"
      return 2
    fi
  fi

  echo "[agent-autofinish-watch] ${branch}: auto-commit pending changes"
  claim_changed_files "$branch" "$wt" "$status_output"
  run_cmd git -C "$wt" add -A
  run_cmd git -C "$wt" reset -q HEAD -- .omx/state/agent-file-locks.json .dev-ports.json 'apps/logs/*.log' >/dev/null 2>&1 || true

  if git -C "$wt" diff --cached --quiet; then
    echo "[agent-autofinish-watch] ${branch}: nothing left to commit after exclusions"
    return 0
  fi

  local msg_subject msg_body
  msg_subject="Checkpoint pending agent worktree updates"
  msg_body="Automated watcher commit for idle agent branch ${branch}."
  run_cmd git -C "$wt" commit \
    -m "$msg_subject" \
    -m "$msg_body" \
    -m "Constraint: Automated idle-worktree checkpoint to preserve pending agent progress" \
    -m "Rejected: Waiting indefinitely for manual commit | leaves stale branches unreviewed" \
    -m "Confidence: medium" \
    -m "Scope-risk: moderate" \
    -m "Directive: Review auto-checkpoint commits before merge when intent is unclear" \
    -m "Tested: Background watcher preflight checks only" \
    -m "Not-tested: Task-specific runtime/test verification not executed by watcher"
}

ensure_pr_for_branch() {
  local branch="$1"
  local base_branch="$2"
  local wt="$3"
  local pr_url pr_title

  run_cmd git -C "$wt" push -u origin "$branch"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[agent-autofinish-watch] [dry-run] would ensure PR for ${branch} -> ${base_branch}"
    return 0
  fi

  pr_url="$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)"
  if [[ -n "$pr_url" ]]; then
    echo "[agent-autofinish-watch] ${branch}: PR exists ${pr_url}"
    return 0
  fi

  pr_title="$(git -C "$wt" log -1 --pretty=%s 2>/dev/null || true)"
  if [[ -z "$pr_title" ]]; then
    pr_title="Merge ${branch} into ${base_branch}"
  fi

  gh pr create \
    --base "$base_branch" \
    --head "$branch" \
    --title "$pr_title" \
    --body "Automated by scripts/agent-autofinish-watch.sh."

  pr_url="$(gh pr view "$branch" --json url --jq '.url' 2>/dev/null || true)"
  if [[ -n "$pr_url" ]]; then
    echo "[agent-autofinish-watch] ${branch}: PR created ${pr_url}"
  fi
}

process_branch() {
  local branch="$1"
  local wt="$2"

  if [[ "$branch" != "$BRANCH_PREFIX"* ]]; then
    return 0
  fi
  if [[ ! -d "$wt" ]]; then
    return 0
  fi
  if ! git -C "$repo_root" show-ref --verify --quiet "refs/heads/${branch}"; then
    return 0
  fi

  local base_branch head_sha status_output signature status_hash prev_signature prev_status
  base_branch="$(resolve_branch_base "$branch")"
  head_sha="$(git -C "$repo_root" rev-parse "$branch")"
  status_output="$(filtered_status "$wt")"
  status_hash="$(printf '%s' "$status_output" | sha256sum | awk '{print $1}')"
  signature="${head_sha}|${status_hash}"

  prev_signature="${LAST_SIGNATURE[$branch]:-}"
  prev_status="${LAST_STATUS[$branch]:-}"

  if [[ "$signature" == "$prev_signature" && "$prev_status" == "success" ]]; then
    return 0
  fi
  if [[ "$signature" == "$prev_signature" && "$prev_status" == "failed" && "$RETRY_FAILED" -ne 1 ]]; then
    echo "[agent-autofinish-watch] ${branch}: skipping unchanged failed signature (use --retry-failed to retry)"
    return 0
  fi

  if ! auto_commit_if_needed "$branch" "$wt" "$status_output"; then
    commit_exit=$?
    if [[ "$commit_exit" -eq 2 ]]; then
      LAST_SIGNATURE["$branch"]="$signature"
      LAST_STATUS["$branch"]="waiting-idle"
      return 0
    fi
    LAST_SIGNATURE["$branch"]="$signature"
    LAST_STATUS["$branch"]="failed"
    return 1
  fi

  head_sha="$(git -C "$repo_root" rev-parse "$branch")"
  status_output="$(filtered_status "$wt")"
  status_hash="$(printf '%s' "$status_output" | sha256sum | awk '{print $1}')"
  signature="${head_sha}|${status_hash}"

  local ahead_count
  ahead_count="$(git -C "$repo_root" rev-list --count "${base_branch}..${branch}" 2>/dev/null || echo 0)"
  if [[ ! "$ahead_count" =~ ^[0-9]+$ ]]; then
    ahead_count=0
  fi

  if [[ "$ahead_count" -eq 0 ]]; then
    LAST_SIGNATURE["$branch"]="$signature"
    LAST_STATUS["$branch"]="success"
    return 0
  fi

  if ensure_pr_for_branch "$branch" "$base_branch" "$wt"; then
    LAST_SIGNATURE["$branch"]="$signature"
    LAST_STATUS["$branch"]="success"
    return 0
  fi

  LAST_SIGNATURE["$branch"]="$signature"
  LAST_STATUS["$branch"]="failed"
  return 1
}

run_cycle() {
  local line branch wt cycle_failed
  cycle_failed=0

  while IFS=$'\t' read -r branch wt; do
    [[ -n "${branch:-}" ]] || continue
    if ! process_branch "$branch" "$wt"; then
      cycle_failed=1
    fi
  done < <(list_agent_worktrees)

  save_state
  return "$cycle_failed"
}

if [[ -n "$PID_FILE" ]]; then
  printf '%s\n' "$$" > "$PID_FILE"
fi

echo "[agent-autofinish-watch] Starting monitor"
echo "[agent-autofinish-watch] Base branch   : ${BASE_BRANCH_OVERRIDE}"
echo "[agent-autofinish-watch] Branch prefix : ${BRANCH_PREFIX}"
echo "[agent-autofinish-watch] Interval      : ${INTERVAL_SECONDS}s"
echo "[agent-autofinish-watch] Idle seconds  : ${IDLE_SECONDS}s"
echo "[agent-autofinish-watch] State file    : ${STATE_FILE}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[agent-autofinish-watch] Mode          : dry-run"
fi

load_state
trap 'echo "[agent-autofinish-watch] Stopped."; [[ -n "$PID_FILE" ]] && rm -f "$PID_FILE"; exit 0' INT TERM

while true; do
  run_cycle || true
  if [[ "$ONCE" -eq 1 ]]; then
    break
  fi
  sleep "$INTERVAL_SECONDS"
done

if [[ -n "$PID_FILE" ]]; then
  rm -f "$PID_FILE"
fi
