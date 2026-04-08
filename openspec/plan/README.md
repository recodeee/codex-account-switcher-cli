# OpenSpec Plan Workspace

`openspec/plan/` stores durable, pre-implementation planning workspaces.

Planner narrative documents are governed by `openspec/plan/PLANS.md`.

## Contract

Each plan must be stored as:

```text
openspec/plan/<plan-slug>/
  summary.md
  checkpoints.md
  planner/plan.md
  planner/tasks.md
  architect/tasks.md
  critic/tasks.md
  executor/tasks.md
  writer/tasks.md
  verifier/tasks.md
```

Role folders may also include `README.md`, notes, and evidence files.

## Task file shape

Each role `tasks.md` should keep visible checklist sections:

```md
## 1. Spec
- [ ] 1.1 ...

## 2. Tests
- [ ] 2.1 ...

## 3. Implementation
- [ ] 3.1 ...
```

This keeps planning work readable in an OpenSpec-style checklist format.

## Planner ExecPlan shape

`planner/plan.md` is the narrative execution spec and should include these sections in order:

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

Use `openspec/plan/PLANS.md` for full writing rules and living-document expectations.

Example completed style:

```md
## 1. Spec

- [x] 1.1 Add frontend architecture requirements for Billing route and seat-cost management UI
- [x] 1.2 Validate OpenSpec changes (`openspec validate --specs`)

## 2. Tests

- [x] 2.1 Add Billing page component tests for cycle rendering and monthly total updates on seat add
- [x] 2.2 Update integration navigation flow to include Billing route transitions

## 3. Implementation

- [x] 3.1 Add Billing route wiring in frontend app routes
- [x] 3.2 Add Billing nav item to sidebar/header/account-menu navigation
- [x] 3.3 Implement Billing page with seat table, invite flow, per-seat price, and monthly total
```

## Scaffold command

Use:

```bash
scripts/openspec/init-plan-workspace.sh <plan-slug>
```

Default roles created:

- planner
- architect
- critic
- executor
- writer
- verifier

The scaffold seeds role-specific `tasks.md` checklists for:
- planner
- architect
- critic
- executor
- writer
- verifier

## Checkpoint updates

Update a role checkpoint directly:

```bash
python3 scripts/openspec/update-plan-checkpoint.py \
  --plan <plan-slug> \
  --role <planner|architect|critic|executor|writer|verifier> \
  --id <checkpoint-id> \
  --state <ready|in_progress|blocked|failed|done> \
  --text "checkpoint note"
```

Sync checkpoints from OMX team runtime task state:

```bash
python3 scripts/openspec/sync-team-plan-checkpoints.py \
  --team <team-name> \
  --plan <plan-slug>
```
