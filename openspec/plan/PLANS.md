# OpenSpec Execution Plans for `$ralplan`

This guide defines how `planner/plan.md` must be authored when `$ralplan` creates or iterates an `openspec/plan/<plan-slug>/` workspace.

## Purpose

`planner/plan.md` is a living execution document. It must be self-contained enough that a contributor who only has this repository and this file can execute the plan safely and verify outcomes.

## Non-negotiable rules

1. Keep `planner/plan.md` self-contained and novice-friendly.
2. Keep it up to date as work progresses (do not leave stale steps).
3. Define user-visible outcomes, not just code edits.
4. Name concrete repository-relative files, commands, and expected observations.
5. Keep the four living sections current at all times:
   - `Progress`
   - `Surprises & Discoveries`
   - `Decision Log`
   - `Outcomes & Retrospective`
6. Add a **Revision Note** at the bottom each time the plan materially changes.

## Required sections in `planner/plan.md`

Use this section order:

1. `Purpose / Big Picture`
2. `Progress`
3. `Surprises & Discoveries`
4. `Decision Log`
5. `Outcomes & Retrospective`
6. `Context and Orientation`
7. `Plan of Work`
8. `Concrete Steps`
9. `Validation and Acceptance`
10. `Idempotence and Recovery`
11. `Artifacts and Notes`
12. `Interfaces and Dependencies`
13. `Revision Note`

## Writing style

- Prefer clear prose and short examples.
- Define non-obvious terms in plain language the first time they appear.
- Keep `Progress` as timestamped checkboxes. Split partial progress into completed + remaining items.
- In `Concrete Steps`, include working directory and exact commands.
- In `Validation and Acceptance`, describe observable behavior and expected output.

## Milestone guidance

When risk is high or unknowns are material, include explicit prototype milestones and success/failure criteria. Keep milestones independently verifiable.

## Relationship with role `tasks.md`

- `planner/tasks.md` remains the checklist board.
- `planner/plan.md` remains the narrative execution specification.
- The two files must stay aligned.
