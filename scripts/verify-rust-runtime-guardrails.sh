#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUST_MAIN="${ROOT_DIR}/rust/codex-lb-runtime/src/main.rs"

require_pattern() {
  local pattern="$1"
  if ! rg -F -n "${pattern}" "${RUST_MAIN}" >/dev/null; then
    echo "[guardrails] missing required runtime contract pattern: ${pattern}" >&2
    exit 1
  fi
}

echo "[guardrails] checking rust runtime wildcard proxy contract"
require_pattern '.route("/api/{*path}", any(proxy_api_wildcard))'
require_pattern '.route("/backend-api/{*path}", any(proxy_backend_api_wildcard))'
require_pattern '.route("/v1/{*path}", any(proxy_v1_wildcard))'
require_pattern 'async fn proxy_api_wildcard('
require_pattern 'async fn proxy_backend_api_wildcard('
require_pattern 'async fn proxy_v1_wildcard('
require_pattern 'fn reqwest_method_from_axum('

echo "[guardrails] running rust runtime verification gate"
cd "${ROOT_DIR}/rust"
cargo check -p codex-lb-runtime
cargo test -p codex-lb-runtime --no-run
cargo test -p codex-lb-runtime tests::api_wildcard_forwards_dashboard_auth_session -- --exact
cargo test -p codex-lb-runtime tests::backend_api_wildcard_forwards_query_parameters -- --exact
cargo test -p codex-lb-runtime tests::v1_wildcard_forwards_post_body_content_type_and_set_cookie -- --exact

echo "[guardrails] rust runtime guardrails passed"
