## Why
Operators can see Codex session counts, but they cannot see what each active session is currently working on. That makes it hard to verify routing and quickly identify which account/session is handling a given task.

## What Changes
- Persist a redacted, truncated task preview for `codex_session` sticky-session mappings.
- Expose per-session task preview metadata in the sticky-session list API.
- Add an `activeOnly` sticky-session list filter (30-minute recency window) to focus on currently active sessions.
- Surface the latest active task preview per account in dashboard/account summaries.
- Update `/sessions` and dashboard account cards to show current task previews.
- Add backend/frontend test coverage for capture, filtering, and rendering behavior.

## Impact
- Operators can inspect active Codex session work context per account from Dashboard and Sessions.
- Existing sticky-session delete/purge flows remain unchanged.
- Task previews are privacy-aware (redacted + truncated) and do not backfill historical records.
