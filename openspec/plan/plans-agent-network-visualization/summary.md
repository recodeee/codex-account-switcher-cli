# Plan Summary: plans-agent-network-visualization

- **Mode:** ralplan
- **Status:** approved
- **Task:** Add an image-style live agent topology visualization to `/projects/plans` so OMX/RALPLAN runs are readable at a glance.

## Context

`/projects/plans` already has a runtime observer (active lanes, timeline, resume). The user requested a visual topology similar to a hub-and-connections graph. We should add this as an additive layer without weakening fail-closed behavior.

## RALPLAN-DR

### Principles
1. Additive-only: topology enhances current observer, never replaces fallback sections.
2. Authority-safe: only authoritative runtime telemetry may drive lane authority/state.
3. Deterministic output: stable keying and ordering to prevent visual jitter.
4. Fail-closed UX: when runtime is unavailable or untrusted, keep existing fallback copy primary.

### Decision Drivers (Top 3)
1. Fast operator comprehension during live planning.
2. Safety under partial/unavailable telemetry.
3. Minimal risk / no new dependencies.

### Viable Options
1. **Option A (chosen):** dependency-free SVG mini-topology card added above Active lanes.
   - Pros: closest to requested visual, compact, deterministic, no new package.
   - Cons: extra view-model logic and layout calculations.
2. **Option B:** DOM/CSS chip graph with pseudo-connections.
   - Pros: simpler markup.
   - Cons: weaker visual fidelity, brittle routing lines.
3. **Option C:** timeline/list polish only.
   - Pros: lowest risk.
   - Cons: does not satisfy requested graph-style visualization.

### Why A
Option A best matches the user’s requested visual while keeping scope additive and preserving existing runtime observer fallbacks.

## ADR
- **Decision:** Implement an additive SVG topology card in plans runtime observer.
- **Drivers:** readability, authority safety, deterministic rendering, low dependency risk.
- **Alternatives considered:** DOM-only pseudo-graph; no-graph polish.
- **Why chosen:** best fidelity-to-request with smallest architecture change.
- **Consequences:** more frontend derivation logic and tests.
- **Follow-ups:** consider backend topology hints only if needed later.

## Accepted v1 Guardrails
- Render topology only when `runtime.available` and authoritative agent nodes exist.
- Do **not** synthesize topology nodes from checkpoint-only state in v1.
- Non-authoritative events may annotate text/timeline context but must not escalate lane authority.
- Existing fallback sections/copy remain unchanged.

## Execution Handoff

### Available agent types
`planner`, `architect`, `critic`, `executor`, `test-engineer`, `verifier`, `designer`, `code-reviewer`, `build-fixer`, `writer`, `explore`

### Ralph lane (sequential)
1. `executor` (high): topology view-model + SVG card + integration in plans page.
2. `test-engineer` (medium): update component/integration tests for new card + guardrails.
3. `verifier` (high): run targeted frontend/backend regressions and evidence summary.

### Team lane (parallel)
- Lane A (`executor`, high): topology derivation + rendering integration.
- Lane B (`test-engineer`, medium): tests for render gate, authority boundary, fallback preservation.
- Lane C (`verifier`, high): verification evidence and regression sign-off.

### Team verification path
1. Run plans frontend tests including integration flow.
2. Run plans backend runtime-observer tests.
3. Confirm fallback copy/sections unchanged in unavailable/sparse runtime cases.
4. Verify deterministic node ordering/identity behavior.
