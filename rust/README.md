# Rust runtime workspace

This folder now uses a Cargo workspace so the Python -> Rust migration can happen incrementally.

## Layout

- `codex-lb-runtime/` — current Axum runtime entrypoint (already in use)
- `crates/contracts/` — shared API DTOs between layers
- `crates/domain/` — core domain types/rules
- `crates/application/` — use-case/service interfaces
- `crates/infra-db/` — database adapter placeholder
- `crates/infra-python-bridge/` — temporary bridge helpers for Python fallback/proxying

## Verification

From `rust/`:

```bash
cargo check --workspace
cargo test -p codex-lb-runtime
```
