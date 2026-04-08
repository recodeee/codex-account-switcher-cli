## 1. Implementation

- [x] 1.1 Remove account-card usage-limit grace effect that auto-calls `terminateCliSessions`.
- [x] 1.2 Keep usage-limit countdown visuals intact without implicit termination.
- [x] 1.3 Update account-card tests to assert no auto-termination happens after grace expiry.

## 2. Validation

- [x] 2.1 Run `bun run test src/features/dashboard/components/account-card.test.tsx`.
- [x] 2.2 Run `bun run lint src/features/dashboard/components/account-card.tsx src/features/dashboard/components/account-card.test.tsx`.
- [x] 2.3 Run `bun run typecheck`.
