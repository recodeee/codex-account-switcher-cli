#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER=""
INTERVAL_SECONDS="${MUSAFETY_REVIEW_FIX_WATCH_INTERVAL_SECONDS:-45}"
STATE_FILE=""
BOT_REGEX="${MUSAFETY_REVIEW_FIX_BOT_REGEX:-cr-gpt|chatgpt-codex-connector}"
BASE_BRANCH=""
AGENT_NAME="${MUSAFETY_REVIEW_FIX_AGENT_NAME:-review-fix-bot}"
TASK_PREFIX="${MUSAFETY_REVIEW_FIX_TASK_PREFIX:-review-fix}"
ONCE=0
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: bash scripts/gh-pr-review-autofix-watch.sh --pr <number> [options]

Monitor one PR and dispatch a new auto-fix run only when bot feedback changes.

Options:
  --pr <number>              Pull request number (required)
  --interval <seconds>       Poll interval (default: 45)
  --state-file <path>        Hash state file (default: .omx/state/gh-pr-review-autofix-pr-<pr>.sha256)
  --bot-regex <regex>        Bot login filter (default: cr-gpt|chatgpt-codex-connector)
  --base <branch>            Base branch passed to codex-agent
  --agent <name>             Agent name for codex-agent (default: review-fix-bot)
  --task-prefix <prefix>     Task prefix for codex-agent task name (default: review-fix)
  --dry-run                  Detect changes but do not dispatch codex-agent
  --once                     Run one cycle and exit
  -h, --help                 Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      PR_NUMBER="${2:-}"
      shift 2
      ;;
    --interval)
      INTERVAL_SECONDS="${2:-}"
      shift 2
      ;;
    --state-file)
      STATE_FILE="${2:-}"
      shift 2
      ;;
    --bot-regex)
      BOT_REGEX="${2:-}"
      shift 2
      ;;
    --base)
      BASE_BRANCH="${2:-}"
      shift 2
      ;;
    --agent)
      AGENT_NAME="${2:-}"
      shift 2
      ;;
    --task-prefix)
      TASK_PREFIX="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --once)
      ONCE=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[gh-pr-review-autofix-watch] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PR_NUMBER" ]]; then
  echo "[gh-pr-review-autofix-watch] --pr is required." >&2
  usage >&2
  exit 1
fi

if [[ ! "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "[gh-pr-review-autofix-watch] --pr must be numeric." >&2
  exit 1
fi

if [[ ! "$INTERVAL_SECONDS" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_SECONDS" -lt 5 ]]; then
  echo "[gh-pr-review-autofix-watch] --interval must be an integer >= 5 seconds." >&2
  exit 1
fi

for cmd in git sha256sum; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[gh-pr-review-autofix-watch] Missing required command: $cmd" >&2
    exit 127
  fi
done

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[gh-pr-review-autofix-watch] Not inside a git repository." >&2
  exit 1
fi
repo_root="$(git rev-parse --show-toplevel)"

autofix_script="$repo_root/scripts/gh-pr-review-autofix.sh"
if [[ ! -x "$autofix_script" ]]; then
  echo "[gh-pr-review-autofix-watch] Missing executable: scripts/gh-pr-review-autofix.sh" >&2
  echo "[gh-pr-review-autofix-watch] Run: chmod +x scripts/gh-pr-review-autofix.sh" >&2
  exit 1
fi

if [[ -z "$STATE_FILE" ]]; then
  STATE_FILE="$repo_root/.omx/state/gh-pr-review-autofix-pr-${PR_NUMBER}.sha256"
fi
mkdir -p "$(dirname "$STATE_FILE")"

echo "[gh-pr-review-autofix-watch] Starting monitor for PR #${PR_NUMBER}"
echo "[gh-pr-review-autofix-watch] Interval   : ${INTERVAL_SECONDS}s"
echo "[gh-pr-review-autofix-watch] State file : ${STATE_FILE}"
if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[gh-pr-review-autofix-watch] Mode       : dry-run (no codex-agent dispatch)"
fi

trap 'echo "[gh-pr-review-autofix-watch] Stopped."; exit 0' INT TERM

run_cycle() {
  local prompt_file new_hash prev_hash
  prompt_file="$(mktemp)"

  local preview_cmd=(
    bash "$autofix_script"
    --pr "$PR_NUMBER"
    --dry-run
    --bot-regex "$BOT_REGEX"
    --agent "$AGENT_NAME"
    --task-prefix "$TASK_PREFIX"
    --prompt-out "$prompt_file"
  )
  if [[ -n "$BASE_BRANCH" ]]; then
    preview_cmd+=(--base "$BASE_BRANCH")
  fi

  if ! "${preview_cmd[@]}" >/dev/null; then
    echo "[gh-pr-review-autofix-watch] Preview collection failed for PR #${PR_NUMBER}." >&2
    rm -f "$prompt_file"
    return 1
  fi

  if [[ ! -s "$prompt_file" ]]; then
    echo "[gh-pr-review-autofix-watch] No matching bot feedback for PR #${PR_NUMBER}."
    rm -f "$prompt_file"
    return 0
  fi

  new_hash="$(sha256sum "$prompt_file" | awk '{print $1}')"
  prev_hash="$(cat "$STATE_FILE" 2>/dev/null || true)"

  if [[ -n "$prev_hash" && "$new_hash" == "$prev_hash" ]]; then
    echo "[gh-pr-review-autofix-watch] No new bot feedback for PR #${PR_NUMBER}."
    rm -f "$prompt_file"
    return 0
  fi

  echo "[gh-pr-review-autofix-watch] New bot feedback detected for PR #${PR_NUMBER}."

  if [[ "$DRY_RUN" -eq 1 ]]; then
    echo "[gh-pr-review-autofix-watch] Dry run enabled; skipping dispatch."
    rm -f "$prompt_file"
    return 0
  fi

  local live_cmd=(
    bash "$autofix_script"
    --pr "$PR_NUMBER"
    --bot-regex "$BOT_REGEX"
    --agent "$AGENT_NAME"
    --task-prefix "$TASK_PREFIX"
  )
  if [[ -n "$BASE_BRANCH" ]]; then
    live_cmd+=(--base "$BASE_BRANCH")
  fi

  "${live_cmd[@]}"
  printf '%s\n' "$new_hash" > "$STATE_FILE"
  echo "[gh-pr-review-autofix-watch] Updated state hash."
  rm -f "$prompt_file"
  return 0
}

while true; do
  run_cycle || true
  if [[ "$ONCE" -eq 1 ]]; then
    break
  fi
  sleep "$INTERVAL_SECONDS"
done
