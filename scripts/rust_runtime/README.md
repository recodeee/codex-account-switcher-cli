# Rust runtime phase-0 tooling

## 1) Run Python backend (baseline)

```bash
cd /home/deadpool/Documents/codex-lb
uv run fastapi run app/main.py --reload
```

## 2) Run Rust scaffold runtime

```bash
cd /home/deadpool/Documents/codex-lb/rust/codex-lb-runtime
cargo run
```

Default bind address is `127.0.0.1:8099`.

Open `http://localhost:8099/` to view the runtime health panel.

Rust also exposes a Python-bridge probe endpoint:

- `GET /_python_layer/health` — probes Python `/health*` endpoints and returns `200 ok` or `503 degraded`.
- `GET /_python_layer/apis` — reads Python `openapi.json` and returns the discovered path list (`200 ok` or `503 degraded`).

Optional environment variables:

- `PYTHON_RUNTIME_BASE_URL` (default: `http://127.0.0.1:8000`)
- `RUST_RUNTIME_PYTHON_TIMEOUT_MS` (default: `1500`)

## 3) Compare parity and latency

```bash
cd /home/deadpool/Documents/codex-lb
python scripts/rust_runtime/compare_runtime.py \
  --python-base-url http://127.0.0.1:8000 \
  --rust-base-url http://127.0.0.1:8099 \
  --iterations 20 \
  --endpoints /health /health/live /health/ready /health/startup \
  --strict
```

The script prints JSON with:
- dominant status code match
- content-type match
- canonical JSON body parity and raw body hash match
- endpoint-level mismatch reasons
- p50/p95 latency for both runtimes

Default compared endpoints are:
- `/health`
- `/health/live`
- `/health/ready`
- `/health/startup`

This is phase-0 evidence only. No production traffic cutover is included.

## 4) Rust-only live usage observability endpoints (phase-2)

- `GET /live_usage` returns XML with no-store cache headers
- `GET /live_usage/mapping` returns XML with no-store cache headers

Phase-3 behavior:
- Rust first proxies Python live-usage XML endpoints for parity behavior.
- `GET /live_usage/mapping?minimal=true` query is forwarded upstream.
- If Python is unavailable, Rust falls back to safe zero-session XML skeletons.

## 5) Optional live-usage parity compare

```bash
cd /home/deadpool/Documents/codex-lb
python scripts/rust_runtime/compare_runtime.py \
  --python-base-url http://127.0.0.1:8000 \
  --rust-base-url http://127.0.0.1:8099 \
  --iterations 20 \
  --endpoints /live_usage /live_usage/mapping \
  --strict
```

For XML endpoints, the comparison tool normalizes volatile `generated_at`
timestamps before strict contract matching.
