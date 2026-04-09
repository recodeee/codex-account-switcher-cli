## Why

A full Python-to-Rust rewrite is high-risk without baseline parity tooling and a measurable feasibility gate.
We need to start with a phase-0 implementation that is safe, reversible, and evidence-driven.

## What Changes

- Add a new Rust runtime scaffold (`rust/codex-lb-runtime`) with health/readiness parity endpoints.
- Add a runtime comparison script (`scripts/rust_runtime/compare_runtime.py`) to benchmark and hash-compare response bodies across Python and Rust endpoints.
- Define phase-0 migration requirements in OpenSpec for benchmark gating and contract-parity checks.

## Impact

- Enables immediate start on Rust migration without touching production routing.
- Creates objective evidence for go/no-go decisions before broader porting.
- Keeps rollback trivial because no traffic cutover is performed in this phase.
