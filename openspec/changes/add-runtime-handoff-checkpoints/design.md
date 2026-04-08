## Overview

This change introduces a durable handoff/checkpoint flow for Codex/OMX work when a runtime is close to exhausting quota. Instead of trying to migrate live in-memory agent state, the system creates a structured checkpoint artifact that captures the current task goal, completed work, remaining work, evidence, and resume instructions. A compatible runtime/account can then consume that artifact and start a fresh session with the saved context.

## Goals

1. Preserve user progress before quota exhaustion interrupts a long-running task.
2. Keep the resume path durable, auditable, and fail-closed.
3. Reuse existing codex-auth multi-runtime isolation, live usage parsing, and dashboard account-card state where possible.
4. Avoid surprise auto-mutation of unrelated runtime/account state.

## Non-goals

1. Live transfer of the active Codex process, tmux pane, or in-memory chain-of-thought state.
2. Automatic cross-machine transport in the MVP.
3. Silent resume onto a mismatched account/runtime without an explicit override.

## Architecture

### 1. Checkpoint artifact model

Store a versioned artifact with the minimum fields required to resume deterministically:

- `id`
- `schemaVersion`
- `createdAt`
- `expiresAt`
- `status` (`created`, `ready`, `resumed`, `aborted`, `expired`)
- `sourceRuntime`
- `sourceSnapshot`
- `sourceSessionId`
- `triggerReason` (`quota_low`, `quota_exhausted`, `manual_handoff`)
- `goal`
- `completedWork`
- `nextSteps`
- `blockers`
- `filesTouched`
- `commandsRun`
- `evidenceRefs`
- `checksum`
- `resumeCount`
- `lastResumedAt`

The payload lives in a durable file under the runtime/OMX state root, while the backend stores the index/status data needed for dashboard visibility.

### 2. Creation flow

Checkpoint creation should support two entry paths:

- **Proactive**: when the runtime detects a low-remaining quota threshold and the session still has time to serialize progress cleanly.
- **Reactive**: when the runtime confirms quota exhaustion and must persist a checkpoint before ending the session.

The creation path gathers the latest task preview, current session/runtime identity, and structured progress summary. If any required identity or integrity field is missing, checkpoint creation fails closed rather than generating an ambiguous artifact.

### 3. Resume flow

Resume always starts a new Codex/OMX session. The new runtime/account:

1. validates artifact checksum and freshness
2. validates source/target compatibility rules
3. injects the checkpoint summary into the new session bootstrap
4. marks the artifact `resumed` with audit metadata

If the target runtime/account does not match the allowed constraints, resume is blocked unless the operator explicitly requests an override.

### 4. Dashboard/runtime visibility

The dashboard should expose:

- checkpoint availability per account/runtime
- status (`ready`, `resumed`, `stale`, `aborted`)
- source runtime/account provenance
- a guarded “Continue from checkpoint” action

This is visibility over durable artifacts, not live process control.

## Phasing

### Phase 1 (MVP)

- durable checkpoint artifact format
- CLI/runtime create + resume flows
- read-only dashboard visibility for ready/stale/resumed checkpoints

### Phase 2

- guarded dashboard-triggered resume actions
- low-quota proactive checkpoint suggestions/prompts
- expiration/cleanup automation and richer audit history

## Risks and mitigations

### Over-summarized checkpoints lose crucial context
Mitigation: require structured fields (`goal`, `completedWork`, `nextSteps`, `blockers`, `evidenceRefs`) and fail creation if they are empty.

### Wrong account/runtime consumes the checkpoint
Mitigation: bind artifacts to validated runtime/snapshot identity and require explicit override for mismatches.

### Stale checkpoints get resumed accidentally
Mitigation: TTL + stale status + blocked default resume on expired artifacts.

### Existing dashboard “working now” semantics regress
Mitigation: keep checkpoint status additive; do not reorder the locked CLI session detection cascade or overload live-session evidence with checkpoint state.
