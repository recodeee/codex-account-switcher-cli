#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${DEV_LOG_DIR:-$ROOT_DIR/logs}"
DEFAULT_TAIL_LINES="${DEV_LOG_TAIL_LINES:-80}"

watch_mode="false"
target=""

usage() {
  cat <<'EOF'
Usage:
  bun run logs <target>
  bun run logs -watch <target>

Targets:
  app, server   Python /app API log
  backend       Medusa commerce backend log
  frontend      Next.js frontend log
EOF
}

resolve_target() {
  case "$1" in
    app|server)
      printf '%s\n' "${APP_LOG_FILE:-$LOG_DIR/server.log}"
      ;;
    backend|medusa)
      local primary="${BACKEND_LOG_FILE:-$LOG_DIR/backend.log}"
      if [[ -f "$primary" ]]; then
        printf '%s\n' "$primary"
      else
        printf '%s\n' "$ROOT_DIR/apps/backend/.medusa/backend-dev.log"
      fi
      ;;
    frontend)
      printf '%s\n' "${FRONTEND_LOG_FILE:-$LOG_DIR/frontend.log}"
      ;;
    *)
      return 1
      ;;
  esac
}

while (($# > 0)); do
  case "$1" in
    -watch|--watch|watch)
      watch_mode="true"
      ;;
    -h|--help|help)
      usage
      exit 0
      ;;
    *)
      if [[ -n "$target" ]]; then
        echo "[logs] Unexpected argument: $1" >&2
        usage >&2
        exit 1
      fi
      target="$1"
      ;;
  esac
  shift
done

if [[ -z "$target" ]]; then
  usage >&2
  exit 1
fi

log_file="$(resolve_target "$target" || true)"
if [[ -z "$log_file" ]]; then
  echo "[logs] Unknown target: $target" >&2
  usage >&2
  exit 1
fi

mkdir -p "$(dirname "$log_file")"
touch "$log_file"

echo "[logs] ${target} -> ${log_file}"
if [[ "$watch_mode" == "true" ]]; then
  exec tail -n "$DEFAULT_TAIL_LINES" -f "$log_file"
fi

exec tail -n "$DEFAULT_TAIL_LINES" "$log_file"
