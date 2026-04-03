## Why
Some operators report host freezes during `./redeploy.sh` when Docker builds spike CPU/memory pressure.  
The current workflow may run parallel builds even on low-memory machines, and it has no hard stop when memory+swap are already critically depleted.

## What Changes
- Add resource guardrails in `redeploy.sh`:
  - detect available memory/swap before heavy stages
  - refuse redeploy when both available RAM and swap are critically low
  - auto-switch from parallel to serial Docker builds when memory headroom is below a threshold
- Add explicit control flags/env toggles for build parallelism:
  - `--serial-build`, `--parallel-build`
  - `CODEX_LB_FORCE_SERIAL_BUILD`, `CODEX_LB_FORCE_PARALLEL_BUILD`
- Add configurable resource thresholds:
  - `CODEX_LB_PARALLEL_BUILD_MIN_MEM_MB`
  - `CODEX_LB_MIN_AVAILABLE_MEM_MB`
  - `CODEX_LB_MIN_AVAILABLE_SWAP_MB`
- Update tests and README redeploy guidance.

## Expected Outcome
- Redeploy avoids triggering avoidable host lockups under memory pressure.
- Low-memory environments default to safer serial build behavior.
- Operators can still force specific build modes when needed.
