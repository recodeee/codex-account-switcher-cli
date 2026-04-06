#!/bin/sh
set -eu

normalize_bool() {
  case "$(printf "%s" "${1:-}" | tr "[:upper:]" "[:lower:]")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

host="${NEXT_DEV_HOSTNAME:-0.0.0.0}"
port="${NEXT_DEV_PORT:-5173}"

bun install --frozen-lockfile
bun run sync-version

if normalize_bool "${LOGGING_TO_FILE:-false}"; then
  log_dir="${LOG_DIR:-/var/log/codex-lb}"
  log_file="${FRONTEND_LOG_FILE:-${log_dir}/frontend.log}"
  if mkdir -p "$log_dir" 2>/dev/null && touch "$log_file" 2>/dev/null; then
    echo "[codex-lb] LOGGING_TO_FILE enabled. Frontend logs -> ${log_file}"
    ./node_modules/.bin/next dev --port "$port" --hostname "$host" 2>&1 | tee -a "$log_file"
  else
    echo "[codex-lb] LOGGING_TO_FILE enabled, but ${log_file} is not writable. Falling back to stdout."
    exec ./node_modules/.bin/next dev --port "$port" --hostname "$host"
  fi
else
  exec ./node_modules/.bin/next dev --port "$port" --hostname "$host"
fi
