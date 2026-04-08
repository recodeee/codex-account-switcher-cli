## Why

Large Codex/OMX tasks currently stop cold when an account reaches its 5h or weekly quota window. The operator can often see that an account is about to run out, but the runtime has no durable checkpoint artifact that captures what was finished, what remains, and how another runtime/account should resume safely. That makes long-running work fragile and encourages error-prone copy/paste handoffs.

## What Changes

- add a durable runtime handoff/checkpoint artifact for Codex/OMX sessions that are near quota exhaustion or explicitly handing off to another account/runtime
- define fail-closed identity, freshness, and lifecycle rules so checkpoints can only be resumed by compatible runtime/account targets unless an explicit override is used
- surface checkpoint readiness and resume status through backend/dashboard APIs without pretending to transfer live in-memory state
- add CLI/runtime hooks so OMX can save current progress before quota exhaustion and start a new session from that checkpoint on another runtime/account

## Capabilities

### New Capabilities

- `runtime-handoff-checkpoints`

### Modified Capabilities

- `sticky-session-operations`: dashboard/runtime operations must expose resumable checkpoint state without weakening existing sticky-session safety guarantees
- `frontend-architecture`: the dashboard must present checkpoint status and guarded resume actions for multi-runtime accounts

## Impact

- Code: `app/tools/codex_auth_multi_runtime.py`, `app/modules/dashboard/*`, `app/modules/accounts/{codex_live_usage.py,task_preview_overlay.py,service.py,schemas.py}`, likely new `app/modules/runtime_handoffs/*`
- Frontend: `apps/frontend/src/features/dashboard/components/account-card.tsx`, related schemas/tests, and any checkpoint-specific action surfaces
- OMX/runtime: `.omx` checkpoint storage, runtime progress capture/resume orchestration, and operator-visible status reporting
- Specs: `openspec/specs/runtime-handoff-checkpoints/spec.md`, `openspec/specs/sticky-session-operations/spec.md`, `openspec/specs/frontend-architecture/spec.md`
