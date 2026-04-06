#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
FRONTEND_DEV_PORT="${NEXT_DEV_PORT:-5173}"

port_in_use() {
  local port="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi
  if command -v lsof >/dev/null 2>&1; then
    lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
    return
  fi
  return 1
}

print_help() {
  cat <<'USAGE'
Usage: ./scripts/dev-auto.sh

Starts a local full-stack dev loop:
  - FastAPI backend with --reload on :2455
  - Next.js dev server (HMR) on :5173
USAGE
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help
  exit 0
fi

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd" >&2
    exit 1
  fi
}

require_cmd uv
require_cmd bun

echo "[dev-auto] Installing frontend deps (frozen lockfile)"
bun install --cwd "$FRONTEND_DIR" --frozen-lockfile

dev_pid=""

cleanup() {
  set +e
  if [[ -n "$dev_pid" ]]; then
    kill "$dev_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if port_in_use "$FRONTEND_DEV_PORT"; then
  echo "[dev-auto] Frontend port :$FRONTEND_DEV_PORT is already in use. Skipping Next.js startup and reusing existing server."
else
  echo "[dev-auto] Starting Next.js dev server with HMR on :$FRONTEND_DEV_PORT"
  (
    cd "$FRONTEND_DIR"
    bun run sync-version
    ./node_modules/.bin/next dev --port "$FRONTEND_DEV_PORT" --hostname 0.0.0.0
  ) &
  dev_pid="$!"
fi

echo "[dev-auto] Starting backend with reload on :2455"
echo "[dev-auto] Open http://localhost:$FRONTEND_DEV_PORT for live frontend + API proxy, or http://localhost:2455 for backend-served static export."
cd "$ROOT_DIR"
if [[ -x "$ROOT_DIR/.venv/bin/python" ]]; then
  exec "$ROOT_DIR/.venv/bin/python" -m uvicorn app.main:app --host 0.0.0.0 --port 2455 --reload
fi
exec uv run python -m uvicorn app.main:app --host 0.0.0.0 --port 2455 --reload
