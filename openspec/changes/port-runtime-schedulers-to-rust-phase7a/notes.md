## Integration notes for `rust/codex-lb-runtime/src/main.rs` (integrator)

Wave-7A intentionally avoids direct `main.rs` edits. To wire this lifecycle in integration wave:

1. Import runtime scheduler module:
   - `use runtime::schedulers::{RuntimeSchedulerLifecycle, RuntimeSchedulerJob};`
2. Construct concrete scheduler job implementations (usage/model/sticky cleanup) and pass them to:
   - `let mut schedulers = RuntimeSchedulerLifecycle::new(vec![...]);`
3. Start jobs during runtime startup:
   - `let startup_status = schedulers.start_all();`
   - log `Started/Disabled/AlreadyRunning` statuses.
4. During shutdown flow (after drain/bridge shutdown gates), call:
   - `let stop_status = schedulers.shutdown().await;`
   - preserve reverse-order stop semantics.
5. Keep wildcard proxy routing and existing drain posture unchanged.

## Scope boundary

- This wave ports lifecycle mechanics only (start/stop/shutdown orchestration).
- Python scheduler implementations remain source-of-truth until concrete Rust jobs are wired.
