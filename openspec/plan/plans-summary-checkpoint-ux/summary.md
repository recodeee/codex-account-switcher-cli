# Plan Summary: plans-summary-checkpoint-ux

- **Mode:** ralplan
- **Status:** approved

## RALPLAN-DR

### Principles
- Prefer scannability over raw fidelity for operator-facing status panels.
- Keep backend contracts unchanged; improve presentation at the view layer.
- Preserve fallback visibility for unstructured lines and malformed log rows.
- Keep scope tight: summary + checkpoint log UX only.

### Decision Drivers (Top 3)
- **Fast comprehension:** users should understand plan state at a glance.
- **Low implementation risk:** no schema/API changes, no new dependency.
- **Testability:** deterministic rendering that can be asserted in integration tests.

### Viable Options
1. **Option A (chosen): lightweight line parser + structured cards in `plans-page.tsx`**
   - Pros: small diff, no dependency, resilient fallback, fast to ship.
   - Cons: not full markdown support.
2. **Option B: add markdown renderer dependency and style rich markdown**
   - Pros: richer markdown semantics.
   - Cons: larger footprint/dependency surface, styling variability.
3. **Option C: backend returns fully structured summary/log objects**
   - Pros: strongest contract for UI rendering.
   - Cons: broad cross-layer change, unnecessary for immediate UX issue.

### Why A
Option A best balances speed, clarity, and risk for this user-facing polish request.

## ADR
- **Decision:** Convert raw summary/log `<pre>` blocks into friendlier structured panels using line-level parsing and normalized fallback rendering.
- **Drivers:** readability, minimal change risk, no new deps.
- **Alternatives considered:** dependency-based markdown rendering; backend contract redesign.
- **Why chosen:** fixes current usability pain without widening blast radius.
- **Consequences:** markdown coverage remains intentionally partial; parser must tolerate mixed formats.
- **Follow-ups:** consider dedicated renderer only if future requirements demand rich markdown semantics.

## Execution Handoff
- **Ralph lane (sequential):** implement parser/render updates in `plans-page.tsx`, then extend integration test assertions.
- **Team lane (parallel):**
  - Lane 1 (`executor`, high): UI parser/render update.
  - Lane 2 (`test-engineer`, medium): integration test updates.
  - Lane 3 (`verifier`, high): targeted test/lint evidence.
- **Reasoning guidance:** high for parser/edge-case logic, medium for test updates, high for verification pass.

## Acceptance Criteria
- Summary section renders readable rows/cards (not only raw `<pre>` text block).
- Checkpoints log renders timeline-like entries with timestamp/role/id/state emphasis when parseable.
- Non-parseable lines still appear in a safe readable fallback.
- Existing plans page flow tests pass with new assertions.
