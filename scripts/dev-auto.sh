#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"

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

echo "[dev-auto] Starting Next.js dev server with HMR on :5173"
(
  cd "$FRONTEND_DIR"
  bun run dev --hostname 0.0.0.0
) &
dev_pid="$!"

echo "[dev-auto] Starting backend with reload on :2455"
echo "[dev-auto] Open http://localhost:5173 for live frontend + API proxy, or http://localhost:2455 for backend-served static export."
cd "$ROOT_DIR"
if [[ -x "$ROOT_DIR/.venv/bin/fastapi" ]]; then
  exec "$ROOT_DIR/.venv/bin/fastapi" run app/main.py --host 0.0.0.0 --port 2455 --reload
fi
exec uv run --no-project fastapi run app/main.py --host 0.0.0.0 --port 2455 --reload
