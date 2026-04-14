## Why

The current Rust runtime mostly proxies Python behavior. To reach the approved migration goal (Rust-owned backend + daemon lifecycle), we need a dedicated Phase 8 that freezes daemon/runtime contracts and starts moving lifecycle ownership into Rust-native code with reversible rollout controls.

## What Changes

- Establish a Phase 8 OpenSpec change for daemon-native runtime ownership.
- Define normative requirements for:
  - runtime register/deregister/heartbeat contracts,
  - task lifecycle transitions (claim/start/progress/complete/fail/cancel),
  - heartbeat TTL and stale-lease handling,
  - reversible rollout and fallback expectations.
- Add initial Rust daemon contract/state-machine module with unit tests in `rust/codex-lb-runtime` covering:
  - deterministic lifecycle transitions,
  - explicit progress reporting semantics,
  - explicit deregister semantics,
  - stale heartbeat detection.
- Keep existing wildcard Python fallback posture intact while phase-8 contracts are validated.

## Impact

- Creates a concrete execution baseline for daemon-native ownership work.
- Reduces ambiguity around lifecycle semantics before endpoint-level cutovers.
- Preserves safety by keeping migration additive and rollback-friendly.
