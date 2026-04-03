## Why

When an account becomes deactivated (for example after business-account removal), the dashboard can still show quota bars but does not clearly indicate when those values were last observed. Users need to keep the last known 5h/weekly timers visible with a timestamp context so they can trust historical usage after deactivation.

## What Changes

- Extend account summary payload with last-known usage sample timestamps for primary (5h) and secondary (weekly) windows.
- Show last-known usage time on dashboard/account usage views when account status is deactivated.
- Keep existing quota percentages and reset labels as-is, but add explicit "last seen … ago" context.

## Expected Outcome

- Deactivated accounts preserve last-known 5h/weekly timer context.
- Users can quickly tell that quota values are historical and when they were last updated.
