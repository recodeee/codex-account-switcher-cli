## Why

The package is already at a stable post-merge state for the update-notice fix, but the repo still needs the next patch version and release notes before npm publish and GitHub release creation.

## What Changes

- bump package metadata from `0.1.18` to `0.1.19`
- add a `v0.1.19` release note summarizing the fresh-publish update-notice fix
- keep a small OpenSpec trail for release-prep bookkeeping

## Impact

- `npm publish --access public` can publish `0.1.19`
- GitHub release text has a ready-to-use source file under `releases/`
