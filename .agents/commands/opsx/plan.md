---
name: "OPSX: Plan Workspace"
description: Create or refresh an OpenSpec plan workspace with role folders and tasks checklists
category: Workflow
tags: [workflow, planning, openspec]
---

Create or refresh a durable plan workspace in `openspec/plan/<plan-slug>/`.

**Input**: The argument after `/opsx:plan` is the plan slug (kebab-case).

## Steps

1. Validate input slug (must be kebab-case).
2. Run:
   ```bash
   scripts/openspec/init-plan-workspace.sh <plan-slug>
   ```
3. Confirm the resulting structure includes:
   - `summary.md`
   - `checkpoints.md`
   - `planner/plan.md`
   - `openspec/plan/PLANS.md` guidance is referenced by `planner/plan.md`
   - role folders for `planner`, `architect`, `critic`, `executor`, `writer`, `verifier`
   - `tasks.md` in each role folder with visible Spec/Tests/Implementation/Checkpoints sections
4. Show resulting file tree under `openspec/plan/<plan-slug>/`.

## Output

Summarize:
- Workspace location
- Role folders created/refreshed
- Any existing files preserved
- Next step: fill `summary.md` and role `tasks.md` checklists
- Next step: fill `planner/plan.md` using `openspec/plan/PLANS.md` sections
- Optional: start checkpoint tracking with:
  - `python3 scripts/openspec/update-plan-checkpoint.py ...`
  - `python3 scripts/openspec/sync-team-plan-checkpoints.py --team <team> --plan <plan>`

## Guardrails

- Do not delete existing role content.
- Keep plan slug deterministic and readable.
- Preserve existing `tasks.md` content if already present.
