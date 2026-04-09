## 1. Spec
- [x] 1.1 Add delta requirements for persisting dashboard overview snapshots per authenticated Medusa customer.

## 2. Tests
- [x] 2.1 Add frontend test coverage for Medusa metadata dashboard-state read/write helpers.
- [x] 2.2 Add dashboard hook coverage to verify metadata hydration/persistence wiring when customer token exists.

## 3. Implementation
- [x] 3.1 Extend Medusa customer schema parsing to include metadata for customer-auth flows.
- [x] 3.2 Add Medusa customer metadata helpers that load and save dashboard overview snapshots.
- [x] 3.3 Wire dashboard overview hook to hydrate from metadata and persist successful snapshots best-effort.

## 4. Checkpoints
- [x] 4.1 Run targeted frontend tests and lint/typecheck (frontend typecheck reports a pre-existing unrelated TS2322 in `sessions-page.tsx`).
- [x] 4.2 Validate OpenSpec specs.
