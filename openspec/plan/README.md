# OpenSpec Plan Workspace

`openspec/plan/` stores durable, pre-implementation planning workspaces.

## Contract

Each plan must be stored as:

```text
openspec/plan/<plan-slug>/
  summary.md
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
