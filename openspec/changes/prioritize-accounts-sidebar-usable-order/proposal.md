## Why
Operators choose accounts from the Accounts sidebar, but the list does not prioritize immediately usable accounts and does not show both quota windows inline. This makes it slower to pick the best account for immediate use.

## What Changes
- Render compact quota summaries in each Accounts sidebar row with `5h` first and `Weekly` second.
- Sort Accounts sidebar rows so accounts that can be used locally (`Use this` enabled) appear first.
- Within the same usability group, sort by higher 5h remaining quota first, then weekly remaining quota, then email for stable ordering.
- Keep existing `Use this` eligibility logic unchanged.

## Impact
- Faster account selection from the sidebar.
- Better visibility of both short-window (5h) and weekly capacity at a glance.
- No backend API changes.
