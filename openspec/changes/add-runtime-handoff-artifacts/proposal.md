## Why

When a Codex account reaches quota limits during a longer task, operators currently need to manually reconstruct context in another runtime/account. That causes avoidable context loss and inconsistent continuation behavior.

The repo already supports runtime-isolated account switching (`codex-lb-runtime`) and surfaces rollout/task previews in dashboard views, but it has no first-class checkpoint/handoff artifact lifecycle.

## What Changes

- Add a runtime handoff artifact API (`/api/runtime-handoffs`) with durable file-backed metadata and explicit lifecycle states.
- Add a service-level contract for handoff creation, listing, resume, and abort operations.
- Enforce fail-closed resume checks (snapshot existence and expected-target mismatch rejection by default).
- Provide a CLI utility (`python -m app.tools.codex_runtime_handoff`) to create/list/resume/abort handoffs and optionally activate target runtime before resuming.

## Impact

- Operators can continue larger tasks across accounts/runtimes with deterministic checkpoint prompts instead of ad hoc copy-paste.
- No live in-memory session migration is attempted.
- Existing dashboard account-working signal semantics remain unchanged.
