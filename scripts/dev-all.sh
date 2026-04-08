#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
MEDUSA_BACKEND_DIR="$ROOT_DIR/apps/backend"
MEDUSA_LOCK_FILE="$MEDUSA_BACKEND_DIR/.medusa/dev-singleton.lock"
PORT_REGISTRY_FILE="$ROOT_DIR/.dev-ports.json"
LOG_DIR="${DEV_LOG_DIR:-$ROOT_DIR/logs}"
APP_LOG_FILE="${APP_LOG_FILE:-$LOG_DIR/server.log}"
BACKEND_LOG_FILE="${BACKEND_LOG_FILE:-$LOG_DIR/backend.log}"
FRONTEND_LOG_FILE="${FRONTEND_LOG_FILE:-$LOG_DIR/frontend.log}"
APP_PORT="${APP_BACKEND_PORT:-2455}"
DEFAULT_MEDUSA_PORT="${MEDUSA_BACKEND_PORT:-9000}"
DEFAULT_FRONTEND_PORT="${FRONTEND_PORT:-5174}"

app_pid=""
backend_pid=""
frontend_pid=""
ready_label="[dev] Ready"

if [[ -t 1 ]] && [[ -z "${NO_COLOR:-}" ]]; then
  ready_label=$'\033[1;32m[dev] Ready\033[0m'
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[dev] Missing required command: $cmd" >&2
    exit 1
  fi
}

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

find_pid_on_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1; then
    lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -n 1
    return
  fi
  echo ""
}

is_pid_alive() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  [[ "$pid" -gt 1 ]] 2>/dev/null || return 1
  kill -0 "$pid" 2>/dev/null
}

spawn_pid_watcher() {
  local target_pid="$1"
  local output_var="$2"
  local watcher_pid=""
  (
    while kill -0 "$target_pid" 2>/dev/null; do
      sleep 1
    done
  ) &
  watcher_pid="$!"
  printf -v "$output_var" '%s' "$watcher_pid"
}

ensure_log_file() {
  local log_file="$1"
  mkdir -p "$(dirname "$log_file")"
  touch "$log_file"
}

mark_log_session() {
  local label="$1"
  local log_file="$2"
  ensure_log_file "$log_file"
  printf '\n[%s] ==== %s dev session started ====\n' "$(date -Iseconds)" "$label" >>"$log_file"
}

tail_log_on_failure() {
  local label="$1"
  local log_file="$2"
  echo "[dev] ${label} failed to become ready. Recent log output:" >&2
  tail -n 40 "$log_file" >&2 || true
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="$2"
  local label="$3"
  local watched_pid="$4"
  local log_file="$5"
  local attempts=$((timeout_seconds * 5))

  while (( attempts > 0 )); do
    if port_in_use "$port"; then
      return 0
    fi
    if [[ -n "$watched_pid" ]] && ! is_pid_alive "$watched_pid"; then
      tail_log_on_failure "$label" "$log_file"
      exit 1
    fi
    attempts=$((attempts - 1))
    sleep 0.2
  done

  tail_log_on_failure "$label" "$log_file"
  exit 1
}

wait_for_backend_port() {
  local preferred_port="$1"
  local timeout_seconds="$2"
  local label="$3"
  local watched_pid="$4"
  local log_file="$5"
  local attempts=$((timeout_seconds * 5))

  while (( attempts > 0 )); do
    local registry_port
    registry_port="$(read_port_registry_value backend || true)"
    if [[ -n "$registry_port" ]] && port_in_use "$registry_port"; then
      printf '%s\n' "$registry_port"
      return 0
    fi

    local backend_url
    backend_url="$(extract_latest_url "$log_file" "Admin URL" || true)"
    if [[ -n "$backend_url" ]]; then
      local backend_port
      backend_port="$(port_from_url "$backend_url" || true)"
      if [[ -n "$backend_port" ]] && port_in_use "$backend_port"; then
        printf '%s\n' "$backend_port"
        return 0
      fi
    fi

    if [[ -n "$watched_pid" ]] && ! is_pid_alive "$watched_pid"; then
      tail_log_on_failure "$label" "$log_file"
      exit 1
    fi

    attempts=$((attempts - 1))
    sleep 0.2
  done

  if port_in_use "$preferred_port"; then
    printf '%s\n' "$preferred_port"
    return 0
  fi

  tail_log_on_failure "$label" "$log_file"
  exit 1
}

read_medusa_launcher_pid() {
  if [[ ! -f "$MEDUSA_LOCK_FILE" ]]; then
    return 1
  fi
  python3 - "$MEDUSA_LOCK_FILE" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)

pid = payload.get("pid")
if isinstance(pid, int) and pid > 0:
    print(pid)
else:
    print("")
PY
}

read_port_registry_value() {
  local key="$1"
  if [[ ! -f "$PORT_REGISTRY_FILE" ]]; then
    return 1
  fi
  python3 - "$PORT_REGISTRY_FILE" "$key" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
key = sys.argv[2]
try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)

value = payload.get(key)
if isinstance(value, int) and value > 0:
    print(value)
else:
    print("")
PY
}

extract_latest_url() {
  local log_file="$1"
  local marker="$2"
  python3 - "$log_file" "$marker" <<'PY'
import pathlib
import re
import sys

path = pathlib.Path(sys.argv[1])
marker = sys.argv[2]
if not path.exists():
    raise SystemExit(1)

pattern = re.compile(r"https?://[^\s]+")
latest = ""
for line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
    if marker not in line:
        continue
    match = pattern.search(line)
    if match:
        latest = match.group(0)

if latest:
    print(latest)
PY
}

port_from_url() {
  local url="$1"
  python3 - "$url" <<'PY'
import sys
from urllib.parse import urlparse

parsed = urlparse(sys.argv[1])
if parsed.port:
    print(parsed.port)
PY
}

app_port_serves_codex_lb_health() {
  local port="$1"
  local attempts="${2:-10}"

  while (( attempts > 0 )); do
    if python3 - "$port" <<'PY'
import json
import sys
import urllib.error
import urllib.request

port = sys.argv[1]
url = f"http://127.0.0.1:{port}/health"

try:
    with urllib.request.urlopen(url, timeout=0.5) as response:
        payload = json.loads(response.read().decode("utf-8"))
except (OSError, ValueError, urllib.error.URLError, urllib.error.HTTPError):
    raise SystemExit(1)

if payload.get("status") == "ok":
    raise SystemExit(0)

raise SystemExit(1)
PY
    then
      return 0
    fi

    attempts=$((attempts - 1))
    sleep 0.2
  done

  return 1
}

wait_for_url_from_log() {
  local log_file="$1"
  local marker="$2"
  local timeout_seconds="$3"
  local label="$4"
  local watched_pid="$5"
  local fallback_url="$6"
  local attempts=$((timeout_seconds * 5))

  while (( attempts > 0 )); do
    local url
    url="$(extract_latest_url "$log_file" "$marker" || true)"
    if [[ -n "$url" ]]; then
      local url_port
      url_port="$(port_from_url "$url" || true)"
      if [[ -n "$url_port" ]] && port_in_use "$url_port"; then
        printf '%s\n' "$url"
        return 0
      fi
    fi

    local fallback_port
    fallback_port="$(port_from_url "$fallback_url" || true)"
    if [[ -n "$fallback_port" ]] && port_in_use "$fallback_port"; then
      printf '%s\n' "$fallback_url"
      return 0
    fi

    if [[ -n "$watched_pid" ]] && ! is_pid_alive "$watched_pid"; then
      tail_log_on_failure "$label" "$log_file"
      exit 1
    fi

    attempts=$((attempts - 1))
    sleep 0.2
  done

  tail_log_on_failure "$label" "$log_file"
  exit 1
}

start_frontend_dev_server() {
  local medusa_port="$1"

  mark_log_session "frontend" "$FRONTEND_LOG_FILE"
  echo "[dev] Starting frontend on http://localhost:${DEFAULT_FRONTEND_PORT}"
  (
    cd "$FRONTEND_DIR"
    START_APP_BACKEND=false \
    START_MEDUSA_BACKEND=false \
    API_PROXY_TARGET="http://localhost:${APP_PORT}" \
    NEXT_PUBLIC_MEDUSA_BACKEND_URL="http://localhost:${medusa_port}" \
    NEXT_DEV_PORT="$DEFAULT_FRONTEND_PORT" \
    sh ./scripts/run-frontend-dev.sh
  ) >>"$FRONTEND_LOG_FILE" 2>&1 &
  frontend_pid="$!"
}

cleanup() {
  set +e
  for pid in "$frontend_pid" "$backend_pid" "$app_pid"; do
    if [[ -n "$pid" ]] && is_pid_alive "$pid"; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

require_cmd bun
require_cmd python3

mkdir -p "$LOG_DIR"

echo "[dev] Quiet mode enabled. Service logs are written to $LOG_DIR"

app_needs_wait=false
mark_log_session "app" "$APP_LOG_FILE"
if port_in_use "$APP_PORT"; then
  existing_app_pid="$(find_pid_on_port "$APP_PORT" || true)"
  if ! app_port_serves_codex_lb_health "$APP_PORT" 10; then
    echo "[dev] App API port ${APP_PORT} is already in use by a non-codex-lb service. Stop it or set APP_BACKEND_PORT to a free port." >&2
    exit 1
  fi

  echo "[dev] Reusing app API on http://localhost:${APP_PORT}"
  if [[ -n "$existing_app_pid" ]] && is_pid_alive "$existing_app_pid"; then
    spawn_pid_watcher "$existing_app_pid" app_pid
  fi
else
  echo "[dev] Starting app API on http://localhost:${APP_PORT}"
  (
    cd "$ROOT_DIR"
    LOGGING_TO_FILE=false APP_BACKEND_PORT="$APP_PORT" sh ./scripts/run-server-dev.sh
  ) >>"$APP_LOG_FILE" 2>&1 &
  app_pid="$!"
  app_needs_wait=true
fi

medusa_port="$DEFAULT_MEDUSA_PORT"
frontend_medusa_port="$medusa_port"
backend_needs_wait=false
mark_log_session "backend" "$BACKEND_LOG_FILE"
existing_medusa_pid="$(read_medusa_launcher_pid || true)"
if [[ -n "$existing_medusa_pid" ]] && is_pid_alive "$existing_medusa_pid"; then
  medusa_port="$(read_port_registry_value backend || true)"
  medusa_port="${medusa_port:-$DEFAULT_MEDUSA_PORT}"
  echo "[dev] Reusing commerce backend on http://localhost:${medusa_port}/app"
  spawn_pid_watcher "$existing_medusa_pid" backend_pid
else
  echo "[dev] Starting commerce backend"
  (
    cd "$MEDUSA_BACKEND_DIR"
    MEDUSA_PORT="$medusa_port" PORT="$medusa_port" bun run dev
  ) >>"$BACKEND_LOG_FILE" 2>&1 &
  backend_pid="$!"
  backend_needs_wait=true
fi

if [[ "$app_needs_wait" == "true" ]]; then
  wait_for_port "$APP_PORT" 20 "app API" "$app_pid" "$APP_LOG_FILE"
fi

start_frontend_dev_server "$frontend_medusa_port"

if [[ "$backend_needs_wait" == "true" ]]; then
  medusa_port="$(wait_for_backend_port "$medusa_port" 35 "commerce backend" "$backend_pid" "$BACKEND_LOG_FILE")"
  if [[ "$medusa_port" != "$frontend_medusa_port" ]]; then
    echo "[dev] Backend port resolved to ${medusa_port}. Restarting frontend with updated backend URL."
    if is_pid_alive "$frontend_pid"; then
      kill "$frontend_pid" >/dev/null 2>&1 || true
      wait "$frontend_pid" >/dev/null 2>&1 || true
    fi
    start_frontend_dev_server "$medusa_port"
  fi
fi

frontend_url="$(wait_for_url_from_log \
  "$FRONTEND_LOG_FILE" \
  "Frontend dev server:" \
  30 \
  "frontend" \
  "$frontend_pid" \
  "http://localhost:${DEFAULT_FRONTEND_PORT}")"
app_url="http://localhost:${APP_PORT}"
backend_url="$(extract_latest_url "$BACKEND_LOG_FILE" "Admin URL" || true)"
backend_url="${backend_url:-http://localhost:${medusa_port}/app}"

echo
echo "$ready_label"
echo "  app      ${app_url}"
echo "  backend  ${backend_url}"
echo "  frontend ${frontend_url}"
echo
echo "[dev] Watch logs with:"
echo "  bun run logs -watch app"
echo "  bun run logs -watch server"
echo "  bun run logs -watch backend"
echo "  bun run logs -watch frontend"

wait_pids=()
for pid in "$app_pid" "$backend_pid" "$frontend_pid"; do
  if [[ -n "$pid" ]]; then
    wait_pids+=("$pid")
  fi
done

set +e
if ((${#wait_pids[@]} > 0)); then
  wait -n "${wait_pids[@]}"
  exit_code=$?
else
  exit_code=0
fi
set -e

echo "[dev] One dev process exited. Shutting down helper processes..."
exit "$exit_code"
