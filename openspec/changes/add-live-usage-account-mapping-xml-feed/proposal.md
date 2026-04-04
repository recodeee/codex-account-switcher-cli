## Why

Operators can already view raw per-snapshot CLI session counts from `/live_usage`, but that feed does not show which sessions map to known accounts or which accounts are considered `working now` candidates.

A dedicated XML mapping feed makes it easier to monitor CLI-to-account attribution from a single URL.

## What Changes

- Add a new health endpoint: `GET /live_usage/mapping`.
- Add optional compact mode for mapping feed: `GET /live_usage/mapping?minimal=true`.
- Return XML that includes:
  - active snapshot metadata,
  - account rows with mapped snapshot + CLI signal fields,
  - unmapped CLI snapshots.
- Keep existing `GET /live_usage` behavior unchanged.

## Impact

- Faster troubleshooting for session/account mapping issues.
- Better operational visibility for dashboard "Working now" signal sources.
- No breaking API changes.
