#!/usr/bin/env bash
set -euo pipefail

PR_NUMBER=""
BASE_BRANCH=""
AGENT_NAME="${MUSAFETY_REVIEW_FIX_AGENT_NAME:-review-fix-bot}"
TASK_PREFIX="${MUSAFETY_REVIEW_FIX_TASK_PREFIX:-review-fix}"
BOT_REGEX="${MUSAFETY_REVIEW_FIX_BOT_REGEX:-cr-gpt|chatgpt-codex-connector}"
PROMPT_OUT=""
MAX_ITEMS="${MUSAFETY_REVIEW_FIX_MAX_ITEMS:-80}"
DRY_RUN=0

usage() {
  cat <<'USAGE'
Usage: bash scripts/gh-pr-review-autofix.sh --pr <number> [options]

Pull bot review content from GitHub PR reviews/comments and dispatch one focused
Codex auto-fix run for that PR.

Options:
  --pr <number>              Pull request number (required)
  --base <branch>            Base branch passed to codex-agent (default: PR base branch)
  --agent <name>             Agent name for codex-agent (default: review-fix-bot)
  --task-prefix <prefix>     Task prefix for codex-agent task name (default: review-fix)
  --bot-regex <regex>        Bot login filter (default: cr-gpt|chatgpt-codex-connector)
  --max-items <count>        Max review items embedded in prompt (default: 80)
  --prompt-out <path>        Write generated prompt to file
  --dry-run                  Print prompt only (do not dispatch codex-agent)
  -h, --help                 Show help
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pr)
      PR_NUMBER="${2:-}"
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
    --bot-regex)
      BOT_REGEX="${2:-}"
      shift 2
      ;;
    --max-items)
      MAX_ITEMS="${2:-}"
      shift 2
      ;;
    --prompt-out)
      PROMPT_OUT="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[gh-pr-review-autofix] Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [[ -z "$PR_NUMBER" ]]; then
  echo "[gh-pr-review-autofix] --pr is required." >&2
  usage >&2
  exit 1
fi

if [[ ! "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
  echo "[gh-pr-review-autofix] --pr must be numeric." >&2
  exit 1
fi

if [[ ! "$MAX_ITEMS" =~ ^[0-9]+$ ]] || [[ "$MAX_ITEMS" -lt 1 ]]; then
  echo "[gh-pr-review-autofix] --max-items must be a positive integer." >&2
  exit 1
fi

for cmd in git gh jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[gh-pr-review-autofix] Missing required command: $cmd" >&2
    exit 127
  fi
done

if [[ "$DRY_RUN" -ne 1 ]] && ! command -v codex >/dev/null 2>&1; then
  echo "[gh-pr-review-autofix] Missing Codex CLI command: codex" >&2
  exit 127
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "[gh-pr-review-autofix] Not inside a git repository." >&2
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"

if ! gh auth status >/dev/null 2>&1; then
  echo "[gh-pr-review-autofix] gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

if [[ ! -x "$repo_root/scripts/codex-agent.sh" ]]; then
  echo "[gh-pr-review-autofix] Missing scripts/codex-agent.sh. Run: gx setup" >&2
  exit 1
fi

repo_slug="$(gh repo view --json nameWithOwner --jq '.nameWithOwner')"
pr_meta="$(gh pr view "$PR_NUMBER" --json number,title,url,baseRefName,headRefName)"
pr_title="$(jq -r '.title // ""' <<<"$pr_meta")"
pr_url="$(jq -r '.url // ""' <<<"$pr_meta")"
pr_base_branch="$(jq -r '.baseRefName // ""' <<<"$pr_meta")"
pr_head_branch="$(jq -r '.headRefName // ""' <<<"$pr_meta")"

if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$pr_base_branch"
fi
if [[ -z "$BASE_BRANCH" ]]; then
  BASE_BRANCH="$(git -C "$repo_root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
fi
if [[ -z "$BASE_BRANCH" || "$BASE_BRANCH" == "HEAD" ]]; then
  BASE_BRANCH="dev"
fi

fetch_array() {
  local endpoint="$1"
  gh api "$endpoint?per_page=100" --paginate | jq -s 'add // []'
}

reviews_json="$(fetch_array "repos/${repo_slug}/pulls/${PR_NUMBER}/reviews")"
inline_comments_json="$(fetch_array "repos/${repo_slug}/pulls/${PR_NUMBER}/comments")"
issue_comments_json="$(fetch_array "repos/${repo_slug}/issues/${PR_NUMBER}/comments")"

extract_entries() {
  local source="$1"
  local json_payload="$2"
  jq -r \
    --arg source "$source" \
    --arg bot_regex "$BOT_REGEX" \
    '
      .[]?
      | (.user.login // .author.login // "") as $login
      | select($login | test($bot_regex; "i"))
      | (.body // "") as $raw_body
      | ($raw_body
          | gsub("\r"; "")
          | gsub("[ \t]+\n"; "\n")
          | gsub("\n{3,}"; "\n\n")
          | sub("^[[:space:]]+"; "")
          | sub("[[:space:]]+$"; "")) as $body
      | select(($body | length) > 0)
      | [
          $source,
          ((.id // 0) | tostring),
          $login,
          (.html_url // ""),
          ($body | @base64)
        ]
      | @tsv
    ' <<<"$json_payload"
}

declare -a all_entries
while IFS= read -r line; do
  all_entries+=("$line")
done < <(
  {
    extract_entries "review" "$reviews_json"
    extract_entries "inline-comment" "$inline_comments_json"
    extract_entries "conversation-comment" "$issue_comments_json"
  } | sed '/^$/d'
)

declare -A seen
entry_count=0
prompt_file="$(mktemp)"
trap 'rm -f "$prompt_file"' EXIT

{
  echo "You are a focused PR review-fix Codex agent."
  echo
  echo "Repository: ${repo_slug}"
  echo "PR: #${PR_NUMBER}"
  echo "PR URL: ${pr_url}"
  echo "PR title: ${pr_title}"
  echo "PR base branch: ${BASE_BRANCH}"
  echo "PR head branch: ${pr_head_branch}"
  echo
  echo "Task:"
  echo "1) Fix concrete actionable findings from the bot feedback below."
  echo "2) Ignore generic advice that is not tied to a concrete file/behavior in this repo."
  echo "3) Run focused verification for touched files."
  echo "4) Keep output short and operational: include exact commands and concrete next actions."
  echo
  echo "Bot feedback items:"

  for raw in "${all_entries[@]}"; do
    IFS=$'\t' read -r source item_id author url body_b64 <<<"$raw"
    key="${source}:${item_id}"
    if [[ -n "${seen[$key]:-}" ]]; then
      continue
    fi
    seen[$key]=1

    body="$(printf '%s' "$body_b64" | base64 --decode 2>/dev/null || true)"
    if [[ -z "$body" ]]; then
      continue
    fi

    if [[ "${#body}" -gt 3000 ]]; then
      body="${body:0:3000}"$'\n...[truncated]'
    fi

    entry_count=$((entry_count + 1))
    if [[ "$entry_count" -gt "$MAX_ITEMS" ]]; then
      break
    fi

    echo
    echo "[$entry_count] source=${source} id=${item_id} author=${author}"
    if [[ -n "$url" ]]; then
      echo "url: ${url}"
    fi
    echo "comment:"
    echo "$body"
  done

  if [[ "$entry_count" -eq 0 ]]; then
    echo
    echo "(no matching bot feedback found for regex: ${BOT_REGEX})"
  fi
} >"$prompt_file"

if [[ -n "$PROMPT_OUT" ]]; then
  mkdir -p "$(dirname "$PROMPT_OUT")"
  cp "$prompt_file" "$PROMPT_OUT"
fi

if [[ "$entry_count" -eq 0 ]]; then
  echo "[gh-pr-review-autofix] No matching bot feedback found for PR #${PR_NUMBER} (regex: ${BOT_REGEX})." >&2
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  cat "$prompt_file"
  exit 0
fi

prompt_payload="$(cat "$prompt_file")"
task_name="${TASK_PREFIX}-pr-${PR_NUMBER}"

echo "[gh-pr-review-autofix] Dispatching codex-agent for PR #${PR_NUMBER}."
echo "[gh-pr-review-autofix] Command: bash scripts/codex-agent.sh --task \"${task_name}\" --agent \"${AGENT_NAME}\" --base \"${BASE_BRANCH}\" -- exec \"<generated-prompt>\""
bash "$repo_root/scripts/codex-agent.sh" \
  --task "$task_name" \
  --agent "$AGENT_NAME" \
  --base "$BASE_BRANCH" \
  -- exec "$prompt_payload"
