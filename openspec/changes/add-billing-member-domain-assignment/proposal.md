## Why

Operators can open each billed business account in `/billing`, but the member list is still a static read-only snapshot. They need the dialog to reflect the accounts already visible in the dashboard, grouped into existing business accounts by email domain, while keeping unmatched personal-email accounts inside the current billed businesses instead of creating extra business rows.

## What Changes

- Group dashboard accounts into existing billing business accounts by the email domain after `@`.
- Keep unmatched/personal-email accounts assigned to existing billed business accounts instead of creating new billing accounts.
- Add Billing dialog controls to add and remove member accounts directly from the business-account member list.
- Save member-list edits back through the existing billing update path and recompute seat counts from the resulting members.

## Impact

- Frontend: `apps/frontend/src/features/billing/*`
- Specs: `openspec/specs/frontend-architecture/spec.md`
- Verification: frontend billing tests, billing lint/typecheck, OpenSpec validation
