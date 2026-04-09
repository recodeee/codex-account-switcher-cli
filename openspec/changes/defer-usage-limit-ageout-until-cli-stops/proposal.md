## Why

Rate-limited accounts were aging out of `Working now` exactly at the 60-second grace boundary even when CLI sessions were still actively running. This prematurely hid active CLI work from operators.

## What Changes

- Keep usage-limit-hit accounts in `Working now` after grace expiry while strong CLI session evidence is still present.
- Keep current task preview visible after grace expiry while the account is still actively working.
- Only drop from `Working now` / hide stale task context after grace when CLI session evidence has actually settled.
- Treat explicit terminal session previews (`failed` / `errored` / `stopped`) as settled state so cards can leave `Working now`.

## Impact

- Active CLI tasks stay visible during usage-limit conditions.
- Dashboard cards avoid cutting in-flight sessions mid-task.
- Stale cards still age out when runtime/session evidence stops.
