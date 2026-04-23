## Why

`codex-auth` caches npm "latest version" results for six hours. When the cached value says the user is already up to date, a freshly published release can stay invisible for hours even though npm already serves the newer version.

## What Changes

- shorten cache reuse for "up-to-date" results so the CLI rechecks npm quickly after publish
- keep the longer cache window for already-known update-available results
- cover the stale negative-cache path with focused tests

## Impact

- `codex-auth` and `codex-auth list` surface fresh releases much sooner after npm publish
- repeated prompts for an already-known update stay stable without hammering npm
