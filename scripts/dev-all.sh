#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/apps/frontend"
MEDUSA_BACKEND_DIR="$ROOT_DIR/apps/backend"

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[dev-all] Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd bun

frontend_pid=""
medusa_pid=""

stop_pid_tree() {
  local pid="$1"
  [[ -n "$pid" ]] || return 0
  [[ "$pid" -gt 1 ]] 2>/dev/null || return 0
  kill -0 "$pid" 2>/dev/null || return 0

  local children
  children="$(ps -eo pid=,ppid= 2>/dev/null | awk -v target="$pid" '$2 == target { print $1 }')"
  for child in $children; do
    stop_pid_tree "$child"
  done

  kill "$pid" 2>/dev/null || true
  sleep 0.2
  if kill -0 "$pid" 2>/dev/null; then
    kill -9 "$pid" 2>/dev/null || true
  fi
}

cleanup() {
  set +e
  if [[ -n "$frontend_pid" ]]; then
    stop_pid_tree "$frontend_pid"
  fi
  if [[ -n "$medusa_pid" ]]; then
    stop_pid_tree "$medusa_pid"
  fi
}

trap cleanup EXIT INT TERM

echo "[dev-all] Starting Medusa backend (apps/backend, default :9000)"
(
  cd "$MEDUSA_BACKEND_DIR"
  exec bun run dev
) &
medusa_pid="$!"

echo "[dev-all] Starting frontend + Python proxy app (apps/frontend + app backend on :2455)"
(
  cd "$FRONTEND_DIR"
  exec bun run dev:fullstack
) &
frontend_pid="$!"

set +e
wait -n "$frontend_pid" "$medusa_pid"
exit_code=$?
set -e

echo "[dev-all] One process exited. Shutting down remaining services..."
exit "$exit_code"
