## 1. Specs

- [ ] 1.1 Add a new `runtime-handoff-checkpoints` capability covering checkpoint creation, integrity, lifecycle, and guarded resume behavior.
- [ ] 1.2 Extend sticky-session/dashboard-facing specs for checkpoint visibility without weakening existing fail-closed live-session behavior.
- [ ] 1.3 Validate OpenSpec artifacts.

## 2. Backend and runtime contract

- [x] 2.1 Add a durable checkpoint artifact schema and storage/index contract.
- [ ] 2.2 Implement checkpoint creation flows for `quota_low`, `quota_exhausted`, and manual handoff triggers.
- [x] 2.3 Implement guarded resume validation and status transitions.
- [ ] 2.4 Add expiration/cleanup rules and audit metadata.

## 3. CLI / OMX integration

- [ ] 3.1 Extend multi-runtime tooling to create/list/resume checkpoints.
- [ ] 3.2 Hook OMX/runtime progress capture so a near-limit session can serialize current work before stop.
- [ ] 3.3 Ensure resume bootstraps a fresh session from checkpoint context instead of pretending to continue the live process.

## 4. Dashboard UX

- [ ] 4.1 Expose checkpoint readiness/status in backend dashboard payloads.
- [ ] 4.2 Render checkpoint status and guarded resume actions in the dashboard UI.
- [ ] 4.3 Keep existing account-card runtime readiness/task preview behavior unchanged for non-checkpoint flows.

## 5. Verification

- [ ] 5.1 Add backend tests for artifact creation, checksum validation, expiration, and fail-closed resume mismatch handling.
- [ ] 5.2 Add tool/runtime tests for create/list/resume checkpoint flows.
- [ ] 5.3 Add frontend tests for checkpoint status rendering and resume gating.
- [ ] 5.4 Run targeted verification:
  - `.venv/bin/pytest tests/unit -k "handoff or checkpoint or sticky_session" -q`
  - `.venv/bin/pytest tests/integration -k "handoff or checkpoint" -q`
  - `cd apps/frontend && bun test src/features/dashboard/components/account-card.test.tsx`
  - `openspec validate --specs`
