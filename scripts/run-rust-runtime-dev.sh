#!/bin/sh
set -eu

script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_root="$(CDPATH= cd -- "${script_dir}/.." && pwd)"

runtime_dir="${RUST_RUNTIME_DIR:-${repo_root}/rust/codex-lb-runtime}"
bind_addr="${RUST_RUNTIME_BIND:-127.0.0.1:8099}"

if [ ! -d "$runtime_dir" ]; then
  echo "[codex-lb] Rust runtime directory not found: $runtime_dir" >&2
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  echo "[codex-lb] Missing required command: cargo" >&2
  exit 1
fi

echo "[codex-lb] Rust runtime: http://${bind_addr}"
cd "$runtime_dir"
exec env RUST_RUNTIME_BIND="$bind_addr" cargo run
