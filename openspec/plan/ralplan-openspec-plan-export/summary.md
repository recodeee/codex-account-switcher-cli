# Plan Summary: ralplan-openspec-plan-export

- **Mode:** ralplan
- **Status:** approved
- **Task:** Improve OMX/OpenSpec planning so rate-limit interruptions can resume reliably in a new chat from where planning stopped.

## Context

The user hit a model/account usage limit during Architect review and lost flow continuity. Current behavior stores partial planning state in `.omx/state/sessions/*/ralplan-state.json` and may create `openspec/plan/*` artifacts, but there is no strict, standardized resume contract that guarantees a fresh chat can continue the same consensus-planning lane safely.

## RALPLAN-DR Snapshot

### Principles

1. **Resume safety first:** never pretend planning is complete when review gates were not passed.
2. **Durable handoff artifacts:** persist enough context so a new chat can resume without manual reconstruction.
3. **Fail-closed state transitions:** if the checkpoint is stale/corrupt/incomplete, force replanning branch instead of silent continuation.
4. **OpenSpec-visible progress:** mirror meaningful planning checkpoints into `openspec/plan/<slug>/` so operators can audit progress.
5. **Low-friction operator UX:** one explicit resume command/path from fresh chat.

### Decision Drivers (Top 3)

1. Reliability across quota/rate-limit interruptions.
2. Deterministic continuation semantics (phase, iteration, next action).
3. Minimal disruption to existing ralplan/plan/opsx workflows.

### Viable Options

- **Option A (chosen):** Add a formal `ralplan resume contract` with durable per-plan handoff artifacts + state normalization + resume command hints.
  - Pros: deterministic continuation, auditable files, works with new chat initialization.
  - Cons: requires updates across skill/runtime/docs.
- **Option B:** Keep current behavior and rely on operator copying prior logs/files manually.
  - Pros: no engineering work.
  - Cons: high error rate; brittle and slow.
- **Option C:** Auto-switch to a different model/account mid-review without explicit handoff artifact.
  - Pros: potentially seamless when available.
  - Cons: hidden state transfer assumptions; hard to debug/fail closed.

**Why A:** It gives explicit, testable continuity without unsafe hidden state assumptions.

## Architect Review (Step 3)

- **Steelman antithesis:** If current summary/plan files already exist, adding extra resume artifacts may be redundant and add maintenance burden.
- **Tradeoff tension:** stronger resilience vs additional file/state complexity.
- **Synthesis:** keep one canonical resume file and one normalized runtime-state schema; avoid proliferating parallel artifacts.

## Critic Verdict (Step 4)

**APPROVE** (iteration 1)

The plan has explicit principles/drivers/options, clear acceptance criteria, concrete verification, and fail-closed recovery behavior.

## ADR

### Decision

Define and implement a canonical ralplan resume protocol:

1. Persist a normalized state payload after every phase transition.
2. Write a durable `openspec/plan/<slug>/handoff.md` whenever planning pauses/fails/gets interrupted.
3. Provide deterministic fresh-chat bootstrap guidance (`$ralplan continue ...`) based on saved state.
4. Mark session state terminal (`active=false`, `current_phase=completed|failed`) on workflow completion/cancel.

### Alternatives considered

- Manual operator resume from shell/log history (rejected: inconsistent, error-prone).
- Hidden automatic model/account handover (rejected: opaque and unsafe).

### Consequences

- Additional runtime/state and documentation work.
- Better interruption resilience and lower operator cognitive load.
- Clearer audit trail for planning progression.

### Follow-ups

1. Add automated stale-active-state sweeper for orphaned sessions.
2. Add optional `/opsx:resume-plan <slug>` helper once runtime contract is stable.

## Acceptance Criteria

1. A fresh chat can resume an interrupted ralplan workflow using saved state + handoff artifact without losing phase/iteration context.
2. `ralplan-state.json` includes at least: `task_slug`, `task_description`, `current_phase`, `iteration`, `status`, `final_plan_path` (when available), and `next_action`.
3. On interruption/failure, `openspec/plan/<slug>/handoff.md` is present with: completed steps, pending gate, exact resume command, and known blockers.
4. On terminal completion/cancel, session state is marked inactive and terminal phase; no dangling `active=true` state remains for that session.
5. Resume path is documented in skill/docs and references OpenSpec plan artifacts.

## Verification Plan

- Simulate interrupted review path (planner done, architect blocked).
- Confirm handoff artifact contents are generated and valid.
- Start new chat/session and run resume command; verify workflow continues from pending gate.
- Complete to terminal state and verify `active=false` plus terminal phase.
- Validate OpenSpec docs/specs remain consistent:
  - `openspec validate --specs`

## Execution Handoff (ralph/team)

### Available-agent-types roster

- `executor`
- `architect`
- `critic`
- `writer`
- `verifier`

### Recommended staffing

- **ralph path (sequential):** executor -> architect/critic validation hooks -> writer -> verifier
- **team path (parallel):**
  - Lane A (`executor`): runtime state schema + phase transition persistence
  - Lane B (`executor`): handoff artifact writer + resume command helper
  - Lane C (`writer`): skill/docs/opsx guidance updates
  - Final gate (`verifier`): interruption/resume end-to-end evidence

### Reasoning levels by lane

- State contract lane: high
- Handoff/resume lane: high
- Docs lane: medium
- Verification lane: high

### Launch hints

- Sequential: `$ralph implement add-ralplan-openspec-plan-export`
- Parallel: `omx team "implement add-ralplan-openspec-plan-export"` or `$team implement add-ralplan-openspec-plan-export`

### Team verification path

1. Run interruption simulation test(s) for planner->architect boundary.
2. Validate generated handoff file under `openspec/plan/<slug>/handoff.md`.
3. Resume from a fresh session and complete architect+critic+closure.
4. Confirm terminal state write (`active=false`, terminal phase) in session state.
5. Run `openspec validate --specs`.
