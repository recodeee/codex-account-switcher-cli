#!/bin/sh
set -eu

normalize_bool() {
  case "$(printf "%s" "${1:-}" | tr "[:upper:]" "[:lower:]")" in
    1|true|yes|on) return 0 ;;
    *) return 1 ;;
  esac
}

port_in_use() {
  port="$1"
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

wait_for_port() {
  target_port="$1"
  timeout_seconds="${2:-8}"
  attempts=$((timeout_seconds * 5))

  while [ "$attempts" -gt 0 ]; do
    if port_in_use "$target_port"; then
      return 0
    fi
    attempts=$((attempts - 1))
    sleep 0.2
  done

  return 1
}

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
frontend_dir="$(CDPATH= cd -- "${script_dir}/.." && pwd)"
repo_root="$(CDPATH= cd -- "${frontend_dir}/../.." && pwd)"

start_app_backend="${START_APP_BACKEND:-true}"
wait_for_backend="${WAIT_FOR_APP_BACKEND:-false}"
backend_host="${APP_BACKEND_HOST:-0.0.0.0}"
backend_port="${APP_BACKEND_PORT:-2455}"
backend_pid=""
start_medusa_backend="${START_MEDUSA_BACKEND:-true}"
wait_for_medusa="${WAIT_FOR_MEDUSA_BACKEND:-false}"
medusa_port="${MEDUSA_BACKEND_PORT:-9000}"
medusa_dir="${repo_root}/apps/backend"
medusa_pid=""
medusa_publishable_key="${NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY:-${MEDUSA_PUBLISHABLE_KEY:-}}"

if [ -z "${API_PROXY_TARGET:-}" ]; then
  export API_PROXY_TARGET="http://localhost:${backend_port}"
fi

cleanup() {
  set +e
  if [ -n "$backend_pid" ] && kill -0 "$backend_pid" 2>/dev/null; then
    kill "$backend_pid" >/dev/null 2>&1 || true
  fi
  if [ -n "$medusa_pid" ] && kill -0 "$medusa_pid" 2>/dev/null; then
    kill "$medusa_pid" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

if normalize_bool "$start_app_backend"; then
  if port_in_use "$backend_port"; then
    echo "[codex-lb] /app backend already running on :${backend_port}. Reusing it."
  else
    echo "[codex-lb] Starting /app backend on :${backend_port} (uvicorn --reload)."
    if [ -x "${repo_root}/.venv/bin/python" ]; then
      (
        cd "$repo_root"
        exec "${repo_root}/.venv/bin/python" -m uvicorn app.main:app --host "$backend_host" --port "$backend_port" --reload
      ) &
    else
      (
        cd "$repo_root"
        exec uv run python -m uvicorn app.main:app --host "$backend_host" --port "$backend_port" --reload
      ) &
    fi
    backend_pid="$!"
    if normalize_bool "$wait_for_backend"; then
      if wait_for_port "$backend_port" 8; then
        echo "[codex-lb] /app backend is ready on :${backend_port}."
      else
        echo "[codex-lb] Warning: backend did not open :${backend_port} within timeout." >&2
      fi
    else
      echo "[codex-lb] /app backend booting in background on :${backend_port}."
    fi
  fi
fi

if normalize_bool "$start_medusa_backend"; then
  if [ ! -d "$medusa_dir" ]; then
    echo "[codex-lb] Warning: Medusa backend directory not found at ${medusa_dir}. Skipping startup." >&2
  elif port_in_use "$medusa_port"; then
    echo "[codex-lb] Medusa backend already running on :${medusa_port}. Reusing it."
  else
    if ! command -v bun >/dev/null 2>&1; then
      echo "[codex-lb] Warning: bun not found, cannot auto-start Medusa backend." >&2
    else
      echo "[codex-lb] Starting Medusa backend on :${medusa_port} (apps/backend)."
      (
        cd "$medusa_dir"
        exec bun run dev
      ) &
      medusa_pid="$!"
      if normalize_bool "$wait_for_medusa"; then
        if wait_for_port "$medusa_port" 15; then
          echo "[codex-lb] Medusa backend is ready on :${medusa_port}."
        else
          echo "[codex-lb] Warning: Medusa backend did not open :${medusa_port} within timeout." >&2
        fi
      else
        echo "[codex-lb] Medusa backend booting in background on :${medusa_port}."
      fi
    fi
  fi
fi

if [ -z "${medusa_publishable_key}" ]; then
  echo "[codex-lb] Warning: Medusa publishable key is missing. Set NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY (or MEDUSA_PUBLISHABLE_KEY) to avoid x-publishable-api-key auth errors." >&2
else
  export NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY="${medusa_publishable_key}"
fi

cd "$frontend_dir"
sh "${script_dir}/run-frontend-dev.sh"
