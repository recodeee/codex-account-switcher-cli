#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="turbo"
TARGET_SERVICES=("server" "frontend")
INSTALL_CODEX_AUTH="${CODEX_LB_INSTALL_CODEX_AUTH:-true}"
BUMP_FRONTEND_VERSION="${CODEX_LB_BUMP_FRONTEND_VERSION:-true}"
FORCE_CODEX_AUTH_INSTALL="false"
FORCE_SERIAL_BUILD="${CODEX_LB_FORCE_SERIAL_BUILD:-false}"
FORCE_PARALLEL_BUILD="${CODEX_LB_FORCE_PARALLEL_BUILD:-false}"
PARALLEL_BUILD_MIN_MEM_MB="${CODEX_LB_PARALLEL_BUILD_MIN_MEM_MB:-4096}"
MIN_AVAILABLE_MEM_MB="${CODEX_LB_MIN_AVAILABLE_MEM_MB:-1024}"
MIN_AVAILABLE_SWAP_MB="${CODEX_LB_MIN_AVAILABLE_SWAP_MB:-512}"
MEMINFO_PATH="${CODEX_LB_MEMINFO_PATH:-/proc/meminfo}"

usage() {
  cat <<'EOF'
Usage: ./redeploy.sh [--turbo|--full] [--skip-codex-auth-install] [--force-codex-auth-install] [--bump-frontend-version|--no-bump-frontend-version] [--serial-build|--parallel-build] [service...]

Modes:
  --turbo  Build in parallel and restart only selected services (default, faster)
  --full   Bring stack down and recreate everything (slower, clean reset)

Flags:
  --skip-codex-auth-install  Skip global codex-auth install/update step
  --force-codex-auth-install Force global codex-auth install/update step
  --bump-frontend-version    Increment frontend/package.json patch version
  --no-bump-frontend-version Keep frontend/package.json version unchanged
  --serial-build             Build services sequentially (safer for low-memory hosts)
  --parallel-build           Force parallel docker builds

Env:
  CODEX_LB_INSTALL_CODEX_AUTH=true|false (default: true)
  CODEX_LB_BUMP_FRONTEND_VERSION=true|false (default: true)
  CODEX_LB_FORCE_SERIAL_BUILD=true|false (default: false)
  CODEX_LB_FORCE_PARALLEL_BUILD=true|false (default: false)
  CODEX_LB_PARALLEL_BUILD_MIN_MEM_MB=4096 (auto-switch to serial below this MemAvailable)
  CODEX_LB_MIN_AVAILABLE_MEM_MB=1024 (abort when both mem/swap are too low)
  CODEX_LB_MIN_AVAILABLE_SWAP_MB=512
  CODEX_LB_MEMINFO_PATH=/proc/meminfo (override for testing/debugging)

Examples:
  ./redeploy.sh
  ./redeploy.sh --turbo server frontend
  ./redeploy.sh --force-codex-auth-install
  ./redeploy.sh --bump-frontend-version
  ./redeploy.sh --no-bump-frontend-version
  ./redeploy.sh --serial-build
  ./redeploy.sh --skip-codex-auth-install --full
  ./redeploy.sh --full
EOF
}

while (($#)); do
  case "$1" in
    --turbo)
      MODE="turbo"
      shift
      ;;
    --full)
      MODE="full"
      shift
      ;;
    --skip-codex-auth-install)
      INSTALL_CODEX_AUTH="false"
      shift
      ;;
    --force-codex-auth-install)
      FORCE_CODEX_AUTH_INSTALL="true"
      shift
      ;;
    --bump-frontend-version)
      BUMP_FRONTEND_VERSION="true"
      shift
      ;;
    --no-bump-frontend-version)
      BUMP_FRONTEND_VERSION="false"
      shift
      ;;
    --serial-build)
      FORCE_SERIAL_BUILD="true"
      FORCE_PARALLEL_BUILD="false"
      shift
      ;;
    --parallel-build)
      FORCE_PARALLEL_BUILD="true"
      FORCE_SERIAL_BUILD="false"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      TARGET_SERVICES=("$@")
      break
      ;;
  esac
done

normalize_bool() {
  local value="${1:-}"
  case "${value,,}" in
    1|true|yes|on) echo "true" ;;
    0|false|no|off) echo "false" ;;
    *)
      echo "Error: expected boolean value, got: ${value}" >&2
      exit 1
      ;;
  esac
}

normalize_positive_int() {
  local value="${1:-}"
  if [[ -z "$value" || ! "$value" =~ ^[0-9]+$ ]]; then
    echo "Error: expected positive integer value, got: ${value}" >&2
    exit 1
  fi
  echo "$value"
}

INSTALL_CODEX_AUTH="$(normalize_bool "$INSTALL_CODEX_AUTH")"
BUMP_FRONTEND_VERSION="$(normalize_bool "$BUMP_FRONTEND_VERSION")"
FORCE_CODEX_AUTH_INSTALL="$(normalize_bool "$FORCE_CODEX_AUTH_INSTALL")"
FORCE_SERIAL_BUILD="$(normalize_bool "$FORCE_SERIAL_BUILD")"
FORCE_PARALLEL_BUILD="$(normalize_bool "$FORCE_PARALLEL_BUILD")"
PARALLEL_BUILD_MIN_MEM_MB="$(normalize_positive_int "$PARALLEL_BUILD_MIN_MEM_MB")"
MIN_AVAILABLE_MEM_MB="$(normalize_positive_int "$MIN_AVAILABLE_MEM_MB")"
MIN_AVAILABLE_SWAP_MB="$(normalize_positive_int "$MIN_AVAILABLE_SWAP_MB")"

if ! command -v docker >/dev/null 2>&1; then
  echo "Error: docker is not installed or not in PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: docker compose is not available." >&2
  exit 1
fi

docker_compose() {
  local cmd=(docker compose "$@")
  if command -v ionice >/dev/null 2>&1; then
    cmd=(ionice -c2 -n7 "${cmd[@]}")
  fi
  if command -v nice >/dev/null 2>&1; then
    cmd=(nice -n 10 "${cmd[@]}")
  fi
  "${cmd[@]}"
}

read_meminfo_kb() {
  local field_name="$1"
  if [[ ! -r "$MEMINFO_PATH" ]]; then
    return 1
  fi
  awk -v field_name="$field_name" '$1 == field_name":" {print $2; exit}' "$MEMINFO_PATH"
}

mem_available_mb() {
  local mem_kb=""
  mem_kb="$(read_meminfo_kb MemAvailable || true)"
  if [[ -z "$mem_kb" ]]; then
    return 1
  fi
  echo $((mem_kb / 1024))
}

swap_free_mb() {
  local swap_kb=""
  swap_kb="$(read_meminfo_kb SwapFree || true)"
  if [[ -z "$swap_kb" ]]; then
    echo 0
    return 0
  fi
  echo $((swap_kb / 1024))
}

require_resource_headroom() {
  local stage="$1"
  local mem_mb=""
  local swap_mb=""
  mem_mb="$(mem_available_mb || true)"
  if [[ -z "$mem_mb" ]]; then
    return
  fi
  swap_mb="$(swap_free_mb)"

  if (( mem_mb < MIN_AVAILABLE_MEM_MB && swap_mb < MIN_AVAILABLE_SWAP_MB )); then
    cat >&2 <<EOF
Error: refusing to continue redeploy at stage '${stage}'.
Host resources are critically low (MemAvailable=${mem_mb} MiB, SwapFree=${swap_mb} MiB).
This safety stop prevents host freezes and forced reboots.

Free memory/swap, then retry with --serial-build.
EOF
    exit 1
  fi
}

should_build_parallel() {
  local mem_mb=""
  if [[ "$FORCE_SERIAL_BUILD" == "true" ]]; then
    return 1
  fi
  if [[ "$FORCE_PARALLEL_BUILD" == "true" ]]; then
    return 0
  fi

  mem_mb="$(mem_available_mb || true)"
  if [[ -z "$mem_mb" ]]; then
    return 0
  fi

  if (( mem_mb < PARALLEL_BUILD_MIN_MEM_MB )); then
    echo "MemAvailable=${mem_mb} MiB (< ${PARALLEL_BUILD_MIN_MEM_MB} MiB); switching to serial docker builds for stability."
    return 1
  fi
  return 0
}

build_services_serial() {
  local service=""
  echo "Building services sequentially: ${TARGET_SERVICES[*]}"
  for service in "${TARGET_SERVICES[@]}"; do
    require_resource_headroom "build:${service}"
    docker_compose build "$service"
  done
}

build_selected_services() {
  require_resource_headroom "build:start"
  if should_build_parallel; then
    echo "Building services in parallel: ${TARGET_SERVICES[*]}"
    if ! docker_compose build --parallel "${TARGET_SERVICES[@]}"; then
      echo "Parallel build failed or not supported, falling back to serial build..."
      build_services_serial
    fi
  else
    build_services_serial
  fi
}

install_codex_auth() {
  local switcher_dir="$ROOT_DIR/codex-account-switcher"
  local state_dir="$ROOT_DIR/.omx/state/redeploy"
  local state_file="$state_dir/codex-auth-switcher.sha256"
  local package_version=""
  local installed_version=""
  local local_fingerprint=""
  local cached_fingerprint=""
  if [[ "$INSTALL_CODEX_AUTH" != "true" ]]; then
    echo "Skipping codex-auth install/update (disabled)."
    return
  fi

  if [[ ! -d "$switcher_dir" ]]; then
    echo "Skipping codex-auth install/update: $switcher_dir not found."
    return
  fi

  if ! command -v npm >/dev/null 2>&1; then
    echo "Error: npm is required to install codex-auth globally. Install Node/npm or pass --skip-codex-auth-install." >&2
    exit 1
  fi

  package_version="$(sed -n 's/^[[:space:]]*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$switcher_dir/package.json" | head -n1)"

  if command -v codex-auth >/dev/null 2>&1; then
    installed_version="$(codex-auth --version 2>/dev/null | sed -n 's|^@imdeadpool/codex-account-switcher/\([0-9][0-9.]*\).*|\1|p' | head -n1 || true)"
    if [[ -z "$installed_version" ]]; then
      installed_version="$(codex-auth --version 2>/dev/null | grep -Eo '[0-9]+\.[0-9]+\.[0-9]+' | head -n1 || true)"
    fi
  fi

  local_fingerprint="$(
    cd "$switcher_dir"
    find . -type f \
      \( -path './src/*' -o -name 'package.json' -o -name 'package-lock.json' -o -name 'tsconfig.json' -o -name 'README.md' -o -name 'LICENSE' \) \
      -print0 \
      | sort -z \
      | xargs -0 -r sha256sum \
      | sha256sum \
      | awk '{print $1}'
  )"

  if [[ -f "$state_file" ]]; then
    cached_fingerprint="$(<"$state_file")"
  fi

  if [[ "$FORCE_CODEX_AUTH_INSTALL" != "true" ]] \
    && [[ -n "$installed_version" ]] \
    && [[ -n "$package_version" ]] \
    && [[ "$installed_version" == "$package_version" ]] \
    && [[ -n "$cached_fingerprint" ]] \
    && [[ "$cached_fingerprint" == "$local_fingerprint" ]]; then
    echo "Skipping codex-auth install/update (already up to date: version ${installed_version})."
    return
  fi

  if [[ "$FORCE_CODEX_AUTH_INSTALL" == "true" ]]; then
    echo "Installing codex-auth globally from local package (forced)..."
  elif [[ -z "$installed_version" ]]; then
    echo "Installing codex-auth globally from local package (not currently installed)..."
  elif [[ "$installed_version" != "$package_version" ]]; then
    echo "Installing codex-auth globally from local package (version mismatch: installed ${installed_version}, local ${package_version})..."
  else
    echo "Installing codex-auth globally from local package (source fingerprint changed)..."
  fi

  (
    set -euo pipefail
    cd "$switcher_dir"
    npm install --silent --no-audit --no-fund
    npm run --silent build
    tarball=""
    tarball="$(npm pack --silent | tail -n1)"
    npm install -g "$tarball" --silent --no-audit --no-fund
    rm -f "$tarball"
  )

  mkdir -p "$state_dir"
  printf '%s\n' "$local_fingerprint" >"$state_file"

  if command -v codex-auth >/dev/null 2>&1; then
    echo "codex-auth install/update complete ($(codex-auth --version 2>/dev/null || echo "version unknown"))."
  else
    echo "Warning: codex-auth install step completed but binary is not on PATH." >&2
  fi
}

install_codex_auth

PYTHON_BIN="$ROOT_DIR/.venv/bin/python"
if [[ ! -x "$PYTHON_BIN" ]]; then
  PYTHON_BIN="$(command -v python3 || command -v python)"
fi

if [[ -z "${PYTHON_BIN:-}" ]]; then
  echo "Error: python is required to read/bump frontend/package.json version." >&2
  exit 1
fi

read_frontend_version() {
"$PYTHON_BIN" - <<'PY'
import json
from pathlib import Path

package_path = Path("frontend/package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
version = package.get("version", "0.0.0")
print(version)
PY
}

bump_frontend_version() {
"$PYTHON_BIN" - <<'PY'
import json
from pathlib import Path

package_path = Path("frontend/package.json")
package = json.loads(package_path.read_text(encoding="utf-8"))
version = package.get("version", "0.0.0")

parts = version.split(".")
if len(parts) != 3 or any(not part.isdigit() for part in parts):
    raise SystemExit(f"Unsupported semver format in frontend/package.json: {version!r}")

major, minor, patch = map(int, parts)
next_version = f"{major}.{minor}.{patch + 1}"
package["version"] = next_version
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
print(next_version)
PY
}

if [[ "$BUMP_FRONTEND_VERSION" == "true" ]]; then
  NEW_VERSION="$(bump_frontend_version)"
  echo "Bumped frontend version to ${NEW_VERSION}"
else
  NEW_VERSION="$(read_frontend_version)"
  echo "Keeping frontend version at ${NEW_VERSION} (auto-bump disabled)."
fi

echo "Redeploying docker compose stack in ${MODE} mode..."

if [[ "$MODE" == "full" ]]; then
  require_resource_headroom "down"
  docker_compose down
  build_selected_services
  require_resource_headroom "up"
  docker_compose up -d "${TARGET_SERVICES[@]}"
else
  build_selected_services
  require_resource_headroom "up"
  docker_compose up -d --no-deps "${TARGET_SERVICES[@]}"
fi

echo "Redeploy complete. Current frontend version: ${NEW_VERSION}"
