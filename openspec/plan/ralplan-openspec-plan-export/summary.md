# Ralplan → OpenSpec Plan Export Bridge

- **Mode:** `ralplan`
- **Status:** Proposed / ready for implementation handoff
- **Scope:** OMX runtime planning + OpenSpec durable plan mirror

## Evidence grounding

Checked current behavior:

- `~/.codex/agents/planner.toml` writes plans to `.omx/plans/*.md`
- `.codex/commands/opsx/new.md` and `.codex/commands/opsx/continue.md` start OpenSpec flow from `openspec/changes/<change>/`
- `openspec/plan/` exists in this repo and is currently empty

**Conclusion:** ralplan currently has no durable OpenSpec-facing export step.

---

## RALPLAN-DR summary

### Principles

- Keep OMX runtime planning behavior intact.
- Add repo-visible OpenSpec plan artifact only after approval/readiness.
- Do not replace `openspec/changes/`; `openspec/plan/` is pre-implementation durability.
- Keep the bridge additive and reversible.
- Preserve existing PRD + test-spec execution gate.

### Decision drivers

1. OMX already depends on `.omx/plans/prd-*.md` and `.omx/plans/test-spec-*.md`.
2. OpenSpec is the durable repo-visible planning/change layer.
3. `openspec/plan/` is the natural destination for approved ralplan exports.

### Options considered

1. **Docs-only convention**
   - Pros: minimal effort
   - Cons: manual, drift-prone
2. **Auto-mirror approved ralplan into `openspec/plan/<slug>/`** ✅ **Chosen**
   - Pros: preserves OMX internals, durable repo artifact, low migration risk
   - Cons: needs export logic + slug/manifest contract
3. **Make `openspec/plan/` the sole planning location**
   - Pros: single visible location
   - Cons: breaks existing OMX runtime assumptions

---

## ADR

### Decision

Add a post-approval ralplan export step that writes:

`openspec/plan/<plan-slug>/`

only after:

- critic approval, and
- `.omx/plans/prd-*.md` + `.omx/plans/test-spec-*.md` existence checks pass.

### Why this was chosen

- Keeps OMX runtime behavior stable.
- Adds durable, repo-visible planning artifacts.
- Creates a clean bridge into OpenSpec change creation.

### Alternatives rejected

- Docs-only workflow: still depends on discipline, no enforcement.
- Replacing `.omx/plans/`: conflicts with existing OMX runtime contract.

### Consequences

- OMX gains one post-approval export step.
- OpenSpec gains durable approved-planning layer before `openspec/changes/`.
- Later execution flows can consume `openspec/plan/<slug>/` as seed context.

---

## Recommended exported artifact shape

```text
openspec/plan/<plan-slug>/
  manifest.json
  summary.md
  prd.md
  test-spec.md
  adr.md
  context.md
  links.md
```

### Minimal content contract

- `manifest.json`
  - `slug`
  - `createdAt`
  - `sourceSessionId`
  - `sourceOmxPlanFiles`
  - `status` (`draft | approved | exported | superseded`)
  - optional `linkedChange`
- `summary.md`
  - RALPLAN-DR summary
  - principles / drivers / options
- `prd.md`
  - copied/normalized from `.omx/plans/prd-*.md`
- `test-spec.md`
  - copied/normalized from `.omx/plans/test-spec-*.md`
- `adr.md`
  - decision / alternatives / consequences / follow-ups
- `links.md`
  - references to related `openspec/changes/<name>/`

---

## Integration behavior

### Proposed flow

1. User runs `ralplan ...`
2. OMX planner writes normal `.omx/plans/*`
3. Architect + Critic approve
4. Gate validates PRD + test spec files
5. OMX exports approved plan into `openspec/plan/<plan-slug>/`
6. Later, `/opsx:new <change>` or `/opsx:ff <change>` optionally consumes this plan as seed context

### Boundary definition

- `openspec/plan/` is **not** the implementation change.
- `openspec/changes/` remains implementation/change SSOT.
- `openspec/plan/` is an approved-planning checkpoint.

---

## Likely implementation touchpoints

### OMX side

- ralplan/planner orchestration
- post-approval export step
- slug generation + manifest writer
- optional `linkedChange` write path

### Repo-local side

- `openspec/plan/` contract docs
- optional `/opsx:new` and `/opsx:ff` detection/linking behavior
- AGENTS/OpenSpec docs updates describing plan-link expectations

### First files to touch

- OMX planner/ralplan runtime implementation
- repo OpenSpec workflow docs
- optional command docs:
  - `.codex/commands/opsx/new.md`
  - `.codex/commands/opsx/ff.md`

---

## Acceptance criteria

- After approved ralplan, `openspec/plan/<slug>/` is created automatically.
- Exported folder contains PRD + test spec + summary + ADR metadata.
- Existing `.omx/plans/` behavior is unchanged.
- Existing ralplan gate still depends on `.omx/plans/prd-*.md` and `.omx/plans/test-spec-*.md`.
- OpenSpec change flow can reference exported plan without ambiguity.

---

## Verification plan

- Run sample ralplan.
- Confirm `.omx/plans/prd-*.md` + `.omx/plans/test-spec-*.md` creation.
- Confirm export into `openspec/plan/<slug>/`.
- Re-run same plan and verify deterministic update/supersede behavior.
- Confirm `/opsx:new` still creates `openspec/changes/<change>/` independently.

---

## Recommended implementation order

1. Define `openspec/plan/<slug>/` artifact contract.
2. Add OMX post-approval export logic.
3. Add repo docs for the new layer.
4. Optionally add `/opsx:new` plan detection/linking.
5. Add regression checks for export + idempotency.

---

## Available-agent-types roster

- `planner` — workflow/export contract
- `architect` — ownership boundaries + artifact model
- `critic` — guardrails + idempotency review
- `executor` — implementation
- `writer` — docs + command help text
- `verifier` — end-to-end export validation

## Follow-up staffing

### Ralph lane

- 1 `executor`
- 1 `verifier`
- Use for controlled single-loop implementation

### Team lane

- Worker 1: OMX export implementation
- Worker 2: OpenSpec docs + opsx integration
- Worker 3: verification harness + idempotency checks

Launch hint:

- `$team 3 "add ralplan to openspec plan export integration"`

### Suggested immediate next step

Create an OpenSpec change, e.g. `add-ralplan-openspec-plan-export`, then implement the bridge.
