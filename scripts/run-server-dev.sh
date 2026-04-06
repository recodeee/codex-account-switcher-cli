#!/bin/sh
set -eu

normalize_bool() {
  case "$(printf "%s" "${1:-}" | tr "[:upper:]" "[:lower:]")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
logging_to_file="${LOGGING_TO_FILE:-true}"
python_bin="${PYTHON_BIN:-}"

if [ -z "$python_bin" ]; then
  if [ -x "${repo_root}/.venv/bin/python" ]; then
    python_bin="${repo_root}/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    python_bin="$(command -v python3)"
  else
    python_bin="$(command -v python)"
  fi
fi

if normalize_bool "${logging_to_file}"; then
  log_dir="${LOG_DIR:-/var/log/codex-lb}"
  if ! mkdir -p "$log_dir" 2>/dev/null || ! touch "$log_dir/.write-check" 2>/dev/null; then
    log_dir="${repo_root}/logs"
  fi
  mkdir -p "$log_dir"
  rm -f "${log_dir}/.write-check" 2>/dev/null || true
  log_file="${SERVER_LOG_FILE:-${log_dir}/server.log}"
  if mkdir -p "$log_dir" 2>/dev/null && touch "$log_file" 2>/dev/null; then
    echo "[codex-lb] Backend server: http://localhost:2455"
    echo "[codex-lb] Server logs -> ${log_file}"
    "$python_bin" -m uvicorn app.main:app --host 0.0.0.0 --port 2455 --reload 2>&1 | tee -a "$log_file"
  else
    echo "[codex-lb] LOGGING_TO_FILE enabled, but ${log_file} is not writable. Falling back to stdout."
    exec "$python_bin" -m uvicorn app.main:app --host 0.0.0.0 --port 2455 --reload
  fi
else
  echo "[codex-lb] Backend server: http://localhost:2455"
  exec "$python_bin" -m uvicorn app.main:app --host 0.0.0.0 --port 2455 --reload
fi
