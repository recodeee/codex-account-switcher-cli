#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
STATIC_DIR="$ROOT_DIR/app/static"

print_help() {
  cat <<'EOF'
Usage: ./scripts/dev-auto.sh

Starts a local full-stack dev loop with automatic frontend rebuild + refresh:
  - FastAPI backend with --reload on :2455
  - Vite dev server (HMR auto-refresh) on :5173
  - Vite build --watch to keep app/static in sync for backend-served UI
EOF
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

if [[ -d "$STATIC_DIR/assets" && ! -w "$STATIC_DIR/assets" ]]; then
  backup_path="${STATIC_DIR}.root-owned.backup-$(date +%Y%m%d-%H%M%S)"
  echo "[dev-auto] Detected non-writable $STATIC_DIR/assets; moving to $backup_path"
  mv "$STATIC_DIR" "$backup_path"
fi

mkdir -p "$STATIC_DIR"

echo "[dev-auto] Installing frontend deps (frozen lockfile)"
bun install --cwd "$FRONTEND_DIR" --frozen-lockfile

watch_pid=""
dev_pid=""

cleanup() {
  set +e
  if [[ -n "$watch_pid" ]]; then
    kill "$watch_pid" >/dev/null 2>&1 || true
  fi
  if [[ -n "$dev_pid" ]]; then
    kill "$dev_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

echo "[dev-auto] Starting frontend build watcher -> app/static"
(
  cd "$FRONTEND_DIR"
  bun run build --watch
) &
watch_pid="$!"

echo "[dev-auto] Starting Vite dev server with HMR on :5173"
(
  cd "$FRONTEND_DIR"
  bun run dev --host 0.0.0.0
) &
dev_pid="$!"

echo "[dev-auto] Starting backend with reload on :2455"
echo "[dev-auto] Open http://localhost:5173 for instant refresh, or http://localhost:2455 for backend-served static."
cd "$ROOT_DIR"
if [[ -x "$ROOT_DIR/.venv/bin/fastapi" ]]; then
  exec "$ROOT_DIR/.venv/bin/fastapi" run app/main.py --host 0.0.0.0 --port 2455 --reload
fi
exec uv run --no-project fastapi run app/main.py --host 0.0.0.0 --port 2455 --reload
