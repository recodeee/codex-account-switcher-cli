## Why
Operators need quick, account-level visibility into who is assigned seats per business account directly from Billing. The current Billing table only shows aggregate seat totals and monthly cost per account.

## What Changes
- Add an `Accounts list` action column to the Billing business-account table.
- Add a `Watch` button per business account row.
- Open an account-scoped dialog that lists members with columns: name, role, seat type, and date added.
- Include non-destructive edit affordances (role/seat dropdown indicators and row actions trigger) to match the intended management UI pattern.
- Add frontend tests for opening and rendering the account list dialog.

## Impact
- Billing supports direct drill-down from aggregate account totals to member-level seat assignments.
- Operators can audit assignments without leaving `/billing`.
- No backend/API schema changes are required.
