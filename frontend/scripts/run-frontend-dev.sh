#!/bin/sh
set -eu

normalize_bool() {
  case "$(printf "%s" "${1:-}" | tr "[:upper:]" "[:lower:]")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
frontend_dir="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
repo_root="$(CDPATH= cd -- "${frontend_dir}/.." && pwd)"
lock_file="${frontend_dir}/.next/dev/lock"

host="${NEXT_DEV_HOSTNAME:-0.0.0.0}"
port="${NEXT_DEV_PORT:-5174}"

port_in_use() {
  ss -ltn "( sport = :$1 )" 2>/dev/null | grep -q LISTEN
}

is_next_dev_process() {
  pid="$1"
  args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
  printf "%s" "$args" | grep -Eiq 'next dev|next/dist/bin/next|next-server'
}

resolve_frontend_next_dev_pid() {
  pid="$1"
  tries=0

  while [ -n "$pid" ] && [ "$pid" -gt 1 ] 2>/dev/null && [ "$tries" -lt 8 ]; do
    if is_next_dev_process "$pid"; then
      args="$(ps -p "$pid" -o args= 2>/dev/null || true)"
      if printf "%s" "$args" | grep -Eiq 'next dev|next/dist/bin/next'; then
        printf "%s\n" "$pid"
        return 0
      fi
    fi

    parent_pid="$(ps -p "$pid" -o ppid= 2>/dev/null | tr -d '[:space:]')"
    if [ -z "$parent_pid" ] || [ "$parent_pid" -le 1 ] 2>/dev/null; then
      break
    fi
    pid="$parent_pid"
    tries=$((tries + 1))
  done

  if [ -n "${1:-}" ] && [ "$1" -gt 1 ] 2>/dev/null; then
    printf "%s\n" "$1"
  fi
}

stop_pid_tree() {
  pid="$1"
  [ -n "$pid" ] || return 0
  [ "$pid" -gt 1 ] 2>/dev/null || return 0
  kill -0 "$pid" 2>/dev/null || return 0

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

collect_frontend_next_pids() {
  ps -eo pid= 2>/dev/null | while read -r pid; do
    [ -n "$pid" ] || continue
    [ "$pid" -gt 1 ] 2>/dev/null || continue
    [ -d "/proc/$pid" ] || continue

    if ! is_next_dev_process "$pid"; then
      continue
    fi

    process_cwd="$(readlink -f "/proc/$pid/cwd" 2>/dev/null || true)"
    if [ "$process_cwd" = "$frontend_dir" ]; then
      printf "%s\n" "$pid"
    fi
  done | sort -u
}

if port_in_use "$port"; then
  original_port="$port"
  while port_in_use "$port"; do
    port=$((port + 1))
  done
  echo "[codex-lb] Port ${original_port} is busy. Falling back to ${port}."
fi

if [ -f "$lock_file" ]; then
  existing_pid="$(python3 - "$lock_file" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
try:
    data = json.loads(path.read_text(encoding="utf-8"))
except Exception:
    print("")
    raise SystemExit(0)
pid = data.get("pid")
if isinstance(pid, int) and pid > 0:
    print(pid)
else:
    print("")
PY
)"

  if [ -n "$existing_pid" ] && kill -0 "$existing_pid" 2>/dev/null; then
    target_pid="$(resolve_frontend_next_dev_pid "$existing_pid")"
    if [ -n "$target_pid" ] && kill -0 "$target_pid" 2>/dev/null; then
      echo "[codex-lb] Stopping existing Next dev server (PID ${target_pid})."
      stop_pid_tree "$target_pid"
    fi
  fi
fi

extra_next_pids="$(collect_frontend_next_pids)"
if [ -n "$extra_next_pids" ]; then
  echo "[codex-lb] Stopping stale Next dev processes for this frontend: $(printf "%s" "$extra_next_pids" | tr '\n' ' ')"
  for stale_pid in $extra_next_pids; do
    stop_pid_tree "$stale_pid"
  done
fi

rm -f "$lock_file" 2>/dev/null || true

if normalize_bool "${NEXT_DEV_CLEAR_CACHE_ON_START:-true}"; then
  rm -rf "${frontend_dir}/.next/dev/cache" 2>/dev/null || true
fi

bun install --frozen-lockfile
bun run sync-version

logging_to_file="${LOGGING_TO_FILE:-true}"

if normalize_bool "${logging_to_file}"; then
  log_dir="${LOG_DIR:-/var/log/codex-lb}"
  if ! mkdir -p "$log_dir" 2>/dev/null || ! touch "$log_dir/.write-check" 2>/dev/null; then
    log_dir="${repo_root}/logs"
  fi
  mkdir -p "$log_dir"
  rm -f "${log_dir}/.write-check" 2>/dev/null || true
  log_file="${FRONTEND_LOG_FILE:-${log_dir}/frontend.log}"
  if mkdir -p "$log_dir" 2>/dev/null && touch "$log_file" 2>/dev/null; then
    echo "[codex-lb] Frontend dev server: http://localhost:${port}"
    echo "[codex-lb] Frontend logs -> ${log_file}"
    ./node_modules/.bin/next dev --port "$port" --hostname "$host" 2>&1 | tee -a "$log_file"
  else
    echo "[codex-lb] LOGGING_TO_FILE enabled, but ${log_file} is not writable. Falling back to stdout."
    exec ./node_modules/.bin/next dev --port "$port" --hostname "$host"
  fi
else
  echo "[codex-lb] Frontend dev server: http://localhost:${port}"
  exec ./node_modules/.bin/next dev --port "$port" --hostname "$host"
fi
