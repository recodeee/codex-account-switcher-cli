# ExecPlan: ralplan-openspec-plan-export

This ExecPlan is a living document. Keep `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` current as work proceeds.

Follow repository guidance in `openspec/plan/PLANS.md`.

## Purpose / Big Picture

Make ralplan interruption-proof for quota/rate-limit incidents so operators can open a fresh chat and safely continue consensus planning from the exact pending gate (Architect or Critic), instead of reconstructing context from scrollback.

## Progress

- [x] (2026-04-08 12:18Z) Captured scope and constraints from existing ralplan/OpenSpec artifacts and runtime state.
- [x] (2026-04-08 12:20Z) Produced RALPLAN-DR summary with principles/drivers/options and selected the canonical resume-contract approach.
- [x] (2026-04-08 12:23Z) Completed architect tradeoff review and critic quality gate for plan approval.
- [x] (2026-04-08 12:25Z) Published execution-ready handoff with staffing, reasoning lanes, and verification path.

## Surprises & Discoveries

- Observation: Existing plan workspace had a complete summary draft but the planner role artifacts were still scaffold placeholders.
  Evidence: `openspec/plan/ralplan-openspec-plan-export/planner/plan.md` + `planner/tasks.md` contained template text only.
- Observation: Prior architect subagent attempts can fail due account usage limits; plan must not depend on live subagent availability to preserve continuity.
  Evidence: user-provided transcript showing architect role failure at usage-limit boundary.

## Decision Log

- Decision: Use a canonical resume contract centered on normalized `ralplan-state.json` + `openspec/plan/<slug>/handoff.md`.
  Rationale: deterministic continuation with minimal duplication.
  Date/Author: 2026-04-08 / planner

- Decision: Preserve existing `.omx/plans/prd-*.md` and `.omx/plans/test-spec-*.md` gates while adding resume metadata.
  Rationale: avoids breaking established ralph/ralplan gating behavior.
  Date/Author: 2026-04-08 / architect

- Decision: Approve plan after explicit fail-closed acceptance criteria and verification path were added.
  Rationale: quality bar met for testability and operational safety.
  Date/Author: 2026-04-08 / critic

## Outcomes & Retrospective

Consensus planning reached terminal `APPROVE` with an execution-ready handoff. The plan is now suitable to transition into implementation mode (`$ralph` or `$team`) without additional discovery.

## Context and Orientation

Primary touchpoints for implementation:

- Runtime/skill orchestration state:
  - `.omx/state/sessions/*/ralplan-state.json`
  - `.omx/plans/prd-*.md`
  - `.omx/plans/test-spec-*.md`
- Plan workspace and durable artifacts:
  - `openspec/plan/ralplan-openspec-plan-export/summary.md`
  - target: `openspec/plan/<slug>/handoff.md`
- Skill/workflow docs:
  - `/home/deadpool/.codex/skills/ralplan/SKILL.md`
  - `.codex/commands/opsx/plan.md` (and optional new resume helper command docs)

## Plan of Work

1. Define a strict resume-state contract for ralplan phase transitions.
2. Add handoff artifact writing whenever planning pauses/fails due external interruption (including usage limit).
3. Add deterministic bootstrap output so fresh chat can continue with one command.
4. Ensure terminal phases always set inactive state to prevent dangling "active planning" statuses.
5. Document the new resume protocol in skill/command surfaces and verify end-to-end behavior.

## Concrete Steps

Run from repository root:

    cd /home/deadpool/Documents/codex-lb

1) Capture/normalize resume state schema and serializer behavior.

    # implementation step: update runtime ralplan state writer

Expected: state contains phase/iteration/status/next_action and terminal flags on completion.

2) Add handoff artifact generation for interruption boundaries.

    # implementation step: write openspec/plan/<slug>/handoff.md on pause/failure

Expected: artifact includes completed work, pending gate, resume command, blockers.

3) Add fresh-session resume bootstrap helper output.

    # implementation step: emit deterministic "$ralplan continue ..." hints

Expected: new chat can resume without manual plan reconstruction.

4) Verify behavior and OpenSpec consistency.

    openspec validate --specs

Expected: specs remain valid; resume flow evidence captured.

## Validation and Acceptance

Acceptance requires:

- interrupted planning emits durable handoff artifact;
- fresh chat resumes same plan slug/gate deterministically;
- terminal completion writes inactive terminal state;
- existing PRD/test-spec gate semantics remain unchanged;
- OpenSpec validation passes.

## Idempotence and Recovery

- Re-running state normalization should be idempotent (same semantic status, no duplicate irreversible mutations).
- Re-running handoff generation should overwrite/update the same `handoff.md` for a slug with latest status, not fork random files.
- If resume data is incomplete or corrupt, fail closed: mark as `needs_replan` and route back through planner step.

## Artifacts and Notes

- Context snapshot reused: `.omx/context/ralplan-openspec-plan-folder-20260408T000000Z.md`
- Approved summary: `openspec/plan/ralplan-openspec-plan-export/summary.md`
- Planner checklist/status: `openspec/plan/ralplan-openspec-plan-export/planner/tasks.md`

## Interfaces and Dependencies

Required contract fields (minimum):

- `task_slug`
- `task_description`
- `current_phase`
- `iteration`
- `status`
- `next_action`
- `final_plan_path` (when terminal)
- `active`

Dependencies:

- ralplan orchestration state writer
- OpenSpec plan workspace artifact generation
- optional opsx command docs/helpers for resume ergonomics

## Revision Note

- 2026-04-08 12:25Z: Replaced scaffold with approved consensus plan for quota/rate-limit-safe ralplan resume workflow.
