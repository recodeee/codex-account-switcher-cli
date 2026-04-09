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

## 3) Compare parity and latency

```bash
cd /home/deadpool/Documents/codex-lb
python scripts/rust_runtime/compare_runtime.py \
  --python-base-url http://127.0.0.1:8000 \
  --rust-base-url http://127.0.0.1:8099 \
  --iterations 20 \
  --endpoints /health /health/live
```

The script prints JSON with:
- dominant status code match
- dominant body hash match
- p50/p95 latency for both runtimes

This is phase-0 evidence only. No production traffic cutover is included.
