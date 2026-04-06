#!/bin/sh
set -eu

normalize_bool() {
  case "$(printf "%s" "${1:-}" | tr "[:upper:]" "[:lower:]")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

if normalize_bool "${LOGGING_TO_FILE:-false}"; then
  log_dir="${LOG_DIR:-/var/log/codex-lb}"
  log_file="${SERVER_LOG_FILE:-${log_dir}/server.log}"
  if mkdir -p "$log_dir" 2>/dev/null && touch "$log_file" 2>/dev/null; then
    echo "[codex-lb] LOGGING_TO_FILE enabled. Server logs -> ${log_file}"
    fastapi run app/main.py --host 0.0.0.0 --port 2455 --reload 2>&1 | tee -a "$log_file"
  else
    echo "[codex-lb] LOGGING_TO_FILE enabled, but ${log_file} is not writable. Falling back to stdout."
    exec fastapi run app/main.py --host 0.0.0.0 --port 2455 --reload
  fi
else
  exec fastapi run app/main.py --host 0.0.0.0 --port 2455 --reload
fi
