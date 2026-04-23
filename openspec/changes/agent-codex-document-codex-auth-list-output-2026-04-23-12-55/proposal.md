## Why

The README mentions `codex-auth list`, but it does not clearly show that the first column in the default output is the saved account/snapshot name.

## What Changes

- add a small `codex-auth list` example block to the README
- clarify that default list output is account-name-first and marks the active row with `*`

## Impact

- users can recognize the account column immediately when reading the docs
- the documented output matches the real CLI shape more closely
