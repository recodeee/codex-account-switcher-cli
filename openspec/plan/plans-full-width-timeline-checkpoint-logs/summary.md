# Plan Summary: plans-full-width-timeline-checkpoint-logs

- **Mode:** ralplan
- **Status:** approved

## RALPLAN-DR

### Principles
- Owned layout boundaries: full-width behavior is scoped to the detail pane, not the page shell.
- Composable rendering: shared primitives + mode adapters, not a renderer monolith.
- Accessible interaction parity: pointer and keyboard flows are required.
- Evidence-first completion: integration proofs gate acceptance.

### Decision Drivers (Top 3)
- Satisfy explicit user request: open Summary in a full-width view and improve checkpoint-log readability.
- Keep risk low by preserving the existing 2-column page shell.
- Prevent compact/expanded drift via shared rendering primitives and adapter wiring.

### Viable Options
1. **Option A (chosen):** in-place detail-pane expansion with owned subgrid.
   - Pros: minimal churn, explicit ownership, fast delivery.
   - Cons: still requires careful local layout/focus handling.
2. **Option B:** modal/dialog expansion.
   - Pros: obvious focus mode.
   - Cons: overlay/scroll-lock/focus-trap complexity.
3. **Option C:** dedicated route.
   - Pros: deep-linkable semantics.
   - Cons: over-scoped for this request.

## ADR
- **Decision:** Implement expanded full-width mode only inside the right detail pane and keep outer shell unchanged.
- **Drivers:** explicit UX ask, low blast radius, testable a11y.
- **Alternatives considered:** modal/dialog; dedicated route.
- **Why chosen:** best speed/risk balance without backend or routing changes.
- **Consequences:** adds local compact/expanded state and stronger interaction/focus test coverage.
- **Follow-ups:** consider deep-link route only if users request shareable expanded views.

## Execution Handoff
- **Ralph lane (sequential):**
  1. Add detail-pane-owned expanded state + panel.
  2. Extract shared primitives + compact/expanded adapters.
  3. Add keyboard/focus contracts.
  4. Extend integration tests for open/close/parity/fallback.
  5. Run lint/typecheck/tests and publish evidence.
- **Team lane (parallel):**
  - Lane A (`executor`, high): layout/state + trigger/close wiring.
  - Lane B (`executor`, high): shared primitives + adapters.
  - Lane C (`test-engineer`, medium): interaction/focus/parity/fallback tests.
  - Lane D (`verifier`, high): verification evidence + acceptance matrix.

## Acceptance Criteria
- Expanded mode provides detail-pane full-width panel while outer 2-column shell remains unchanged.
- Expand trigger exposes `aria-expanded` + `aria-controls`; `Escape` closes; focus moves on open and returns on close.
- Expanded surface uses distinct label: **Checkpoint Activity Stream** (avoid runtime Timeline naming collision).
- Compact and expanded presentations share rendering primitives; duplicated mapping logic is removed.
- Integration tests assert open/close interaction, focus lifecycle, parity, and fallback strings.
