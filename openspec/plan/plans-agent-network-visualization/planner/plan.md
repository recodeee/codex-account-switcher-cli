# ExecPlan: plans-agent-network-visualization

## Purpose / Big Picture
Add a compact, real-time topology card to `/projects/plans` so users can visually track live ralplan/omx agent orchestration (hub + connected lanes) while keeping current runtime observer fallbacks as source of truth when telemetry is unavailable.

## Progress
- [x] (2026-04-08 19:35Z) Drafted initial RALPLAN-DR plan and options.
- [x] (2026-04-08 19:53Z) Reworked plan to branch-reality additive scope.
- [x] (2026-04-08 20:09Z) Finalized approved consensus handoff (Planner+Architect+Critic).

## Surprises & Discoveries
- Observation: Early draft inherited stale baseline assumptions about missing plans route/modules.
  Evidence: Architect/Critic review forced re-baseline to existing `/projects/plans` + plans backend.
- Observation: Checkpoint-synthesized node conflicted with strict availability gate.
  Evidence: Architect flagged non-executable path when `runtime.available=false`.

## Decision Log
- Decision: Scope to additive topology only over existing plans runtime observer.
  Rationale: Lowest risk, fastest delivery, aligns with user request.
  Date/Author: 2026-04-08 / planner
- Decision: v1 forbids checkpoint-only synthetic topology nodes.
  Rationale: Preserve fail-closed trust boundary.
  Date/Author: 2026-04-08 / planner

## Context and Orientation
Primary files for execution:
- `apps/frontend/src/features/plans/components/plans-page.tsx`
- `apps/frontend/src/features/plans/components/plans-page.test.tsx`
- `apps/frontend/src/__integration__/plans-flow.test.tsx`
- `app/modules/plans/service.py` (verification alignment only; no contract expansion planned)
- `tests/integration/test_plans_api.py` (regression verification)

## Plan of Work
1. Add pure topology derivation helper (stable key/order, authority-safe enrichment).
2. Add `PlanRuntimeTopologyCard` (SVG hub + lane nodes + connections).
3. Integrate card above Active lanes section in Live plan observer.
4. Keep existing Active lanes/Timeline/Resume fallback sections unchanged.
5. Add tests for render gate, authority boundary, deterministic order, and fallback preservation.

## Concrete Steps
    cd /home/deadpool/Documents/codex-lb
    bun run test -- src/features/plans/components/plans-page.test.tsx src/__integration__/plans-flow.test.tsx
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/pytest -p pytest_asyncio.plugin tests/integration/test_plans_api.py -k runtime_observer

## Validation and Acceptance
Must prove:
- topology appears only when runtime is available + authoritative agents exist,
- non-authoritative events do not escalate authority,
- no checkpoint-only synthetic nodes in v1,
- legacy fallback sections/copy still render unchanged.

## Idempotence and Recovery
- Additive UI change only; can be safely reverted by removing topology helper/component integration.
- If runtime payload is partial/unavailable, existing observer continues to provide fallback status.

## Outcomes & Retrospective
Consensus planning achieved with two iterate loops and one rejection recovery. Final plan is approved and execution-ready.
