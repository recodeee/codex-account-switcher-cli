## Why

Two dashboard behaviors are causing operator confusion and stale account churn:

1. **Re-auth on a deactivated card currently attempts a local snapshot switch first**, which can disrupt the current live-account grouping on dashboard refresh.
2. **Accounts deleted from the UI can reappear automatically** when snapshot auto-import is enabled, because snapshot files on disk are re-imported on list/overview fetch.

## What Changes

- Route dashboard **Re-auth** directly to account details (`/accounts?selected=...`) instead of attempting `use-local` first.
- Introduce an **auto-import ignore list** for deleted account IDs.
  - On successful account delete, add account ID to ignore list.
  - Auto-import skips ignored account IDs.
  - Manual import removes account ID from ignore list.
- Add integration coverage for deleted-account non-resurrection under auto-import.

## Impact

- Re-auth becomes non-disruptive to local active snapshot state.
- Deleted accounts remain deleted from UI even when codex-auth snapshot files still exist on disk.
- Manual re-import remains supported.
