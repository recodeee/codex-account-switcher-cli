# ExecPlan: projects-plans-progress-resume

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

## Purpose / Big Picture

Make `/projects/plans` immediately understandable by showing canonical roles (including designer), aggregate completion percentage, and where the workflow currently paused.

## Progress

- [x] (2026-04-08 10:07Z) Capture scope and acceptance criteria for roles + resume checkpoint + progress percentage.
- [x] (2026-04-08 10:11Z) Draft architecture/tradeoff strategy (backend-owned structured progress fields).
- [x] (2026-04-08 10:14Z) Publish approved execution-ready handoff.

## Surprises & Discoveries

- Observation: existing Plans API lacks structured progress/resume fields and omits designer in canonical role order.
  Evidence: `app/modules/plans/service.py` role order + current schema models.

## Decision Log

- Decision: prefer backend-derived progress + current checkpoint instead of frontend markdown parsing.
  Rationale: avoids parser duplication and keeps semantics consistent across consumers.
  Date/Author: 2026-04-08 / planner

## Outcomes & Retrospective

Planning phase complete; ready for executor lane implementation and verifier evidence collection.

## Context and Orientation

Primary files:
- `app/modules/plans/service.py`
- `app/modules/plans/schemas.py`
- `app/modules/plans/api.py`
- `apps/frontend/src/features/plans/schemas.ts`
- `apps/frontend/src/features/plans/components/plans-page.tsx`
- `tests/integration/test_plans_api.py`

## Plan of Work

Implement backend parser/contracts first, then frontend consumption/rendering, then integration verification.

## Concrete Steps

    cd /home/deadpool/Documents/codex-lb
    PYTEST_DISABLE_PLUGIN_AUTOLOAD=1 .venv/bin/python -m pytest -p pytest_asyncio.plugin tests/integration/test_plans_api.py
    cd apps/frontend && bun run test -- --run src/__integration__/plans-flow.test.tsx
    openspec validate --specs

## Validation and Acceptance

Success requires API fields for progress + current checkpoint, UI progress bar + checkpoint summary, and coverage proving fallback behavior.

## Idempotence and Recovery

Changes are additive; safe rollback by removing newly-added schema fields and corresponding UI blocks.

## Artifacts and Notes

See `summary.md` for full RALPLAN-DR + ADR and acceptance matrix.

## Interfaces and Dependencies

- Backend schema/serialization pipeline in `app/modules/plans/*`
- Frontend query schema contract in `apps/frontend/src/features/plans/schemas.ts`
- Plans page UI in `apps/frontend/src/features/plans/components/plans-page.tsx`

## Revision Note

- 2026-04-08 10:14Z: Planner authored and finalized execution handoff.
