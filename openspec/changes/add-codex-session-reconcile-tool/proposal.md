## Why
Operators can switch `codex-auth` to a target account, but already-running Codex sessions can still keep older quota/account context.
This causes mixed session pools and misleading dashboard usage until stale sessions are restarted manually.

We need a safe, repeatable CLI to identify non-matching running sessions and restart only those sessions.

## What Changes
- Add a new operator CLI tool: `app.tools.codex_session_reconcile`.
- Match sessions using a reference keep-session fingerprint derived from local rollout logs.
- Default to dry-run; require explicit `--apply` for destructive restarts.
- Scope actions to the current repo by default, with optional all-session scope.
- Use graceful restart semantics (TERM, wait, optional KILL fallback).
- Add unit tests for matching, safety gates, and restart behavior.

## Impact
- Faster, safer convergence after account switching.
- Lower risk of killing unrelated Codex sessions by default.
- No API/database schema changes.
