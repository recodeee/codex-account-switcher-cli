# AGENTS

# ExecPlans

When writing complex features or significant refactors, use an ExecPlan (as described in .agent/PLANS.md) from design to implementation.

## Environment

- Python: .venv/bin/python (uv, CPython 3.13.3)
- GitHub auth for git/API is available via env vars: `GITHUB_USER`, `GITHUB_TOKEN` (PAT). Do not hardcode or commit tokens.
- For authenticated git over HTTPS in automation, use: `https://x-access-token:${GITHUB_TOKEN}@github.com/<owner>/<repo>.git`

## Code Conventions

The `/project-conventions` skill is auto-activated on code edits (PreToolUse guard).

| Convention              | Location                              | When                         |
| ----------------------- | ------------------------------------- | ---------------------------- |
| Code Conventions (Full) | `/project-conventions` skill          | On code edit (auto-enforced) |
| Git Workflow            | `.agents/conventions/git-workflow.md` | Commit / PR                  |

## UI/UX Skill Default (UI Pro Max)

- For any frontend/UI/UX request (new page, component, styling, layout, redesign, or UI review), **always load and apply** `.codex/skills/ui-ux-pro-max/SKILL.md` first.
- Treat `ui-ux-pro-max` as the default UI decision surface unless the user explicitly asks to skip it.
- Follow the skill workflow before implementation (including design-system guidance) so generated UI stays consistent and high quality.

## Git Hygiene Preference

- Prefer committing and pushing completed work by default unless the user explicitly asks to keep it local.
- Do not commit ephemeral local runtime artifacts (for example `.dev-ports.json` and `apps/logs/*.log`).

## CLI Session Detection Lock (Dashboard / Accounts)

The current CLI session detection behavior is intentionally frozen and must stay order-sensitive.

Canonical implementation:

- `frontend/src/utils/account-working.ts`
  - `hasActiveCliSessionSignal(...)`
  - `hasFreshLiveTelemetry(...)`
  - `getFreshDebugRawSampleCount(...)`

Locked detection cascade (do not reorder):

1. `codexAuth.hasLiveSession`
2. Fresh live telemetry / live session count
3. Tracked session counters (`codexTrackedSessionCount` / `codexSessionCount`)
4. Fresh debug raw samples

Regression lock:

- `frontend/src/utils/account-working.test.ts` (`hasActiveCliSessionSignal` + `isAccountWorkingNow` suites)

Rule for future edits:

- Do not change this cascade unless explicitly requested by the user and accompanied by updated regression tests proving the new behavior.

## Rust Runtime Proxy Lock (`rust/codex-lb-runtime/src/main.rs`)

The Rust runtime should stay a **thin proxy** for app APIs unless explicitly requested otherwise.

Canonical routing posture:

- Keep wildcard pass-through routes enabled:
  - `/api/{*path}`
  - `/backend-api/{*path}`
  - `/v1/{*path}`
- Prefer generic proxy handlers over large explicit per-endpoint Rust route lists.

Auth/session rule:

- Treat Python as the source of truth for dashboard auth/session enforcement (`validate_dashboard_session` and related dependencies).
- Do not duplicate or drift auth/session logic in Rust endpoint copies unless the user explicitly requests moving that logic into Rust and corresponding tests are updated.

Parallel-work safety:

- When editing `main.rs`, assume other agents may be changing Python API surfaces at the same time.
- Prefer compatibility-preserving proxy behavior over endpoint-specific Rust implementations that can break on concurrent backend changes.
- `main.rs` is now lock-protected for parallel agent sessions. Before **any** edit to
  `rust/codex-lb-runtime/src/main.rs`, claim ownership:
  - `python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "<agent-branch>"`
  - Check owner/lease: `python3 scripts/main_rs_lock.py status`
  - Release when done: `python3 scripts/main_rs_lock.py release --branch "<agent-branch>"`
- Lock ownership is **branch-scoped**; if lock branch and current branch differ, edits are blocked.
- `main.rs` is **integrator-only** by default: branch must match `agent/integrator/...` (configurable via `MAIN_RS_INTEGRATOR_AGENT`).
- If the lock is held by another agent, do not edit `main.rs`; continue in owned module files or hand off to the integrator.

Required verification before claiming Rust runtime changes are complete:

- Confirm wildcard proxy routes still exist in `app_with_state(...)`.
- Confirm proxy helpers are still present and used by wildcard routes.
- Run:
  - `cargo check -p codex-lb-runtime`
  - `cargo test -p codex-lb-runtime --no-run`
- If route/auth behavior changed, add/adjust Rust runtime tests in `rust/codex-lb-runtime/src/main.rs` test module.

## Multi-Agent Execution Contract (Default)

Use this contract whenever multiple agents are active in parallel.

0. Session plan comment + read gate (required)

- Before editing, each agent must post a short session comment/handoff note that includes:
  - plan/change name (or checkpoint id),
  - owned files/scope,
  - intended action.
- Before deleting/replacing code, each agent must read the latest session comments/handoffs first and confirm the target code is in their owned scope.
- If ownership is unclear or overlaps, stop that edit, post a blocker comment, and let the leader/integrator reassign scope.
- For git isolation, each agent must start on a dedicated branch/worktree via `scripts/agent-branch-start.sh "<task-or-plan>" "<agent-name>"`.
- Each agent must claim file ownership before edits:
  - `python3 scripts/agent-file-locks.py claim --branch "<agent-branch>" <file...>`
- If `main.rs` is in scope, claim branch lock first:
  - `python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "<agent-branch>"`
- Non-integrator branches must not edit `main.rs` unless explicit emergency override is approved.
- Agent completion must use `scripts/agent-branch-finish.sh` (preflight conflict check, merge into `dev`, push, delete agent branch).
- `agent-branch-start` and `agent-branch-finish` must fast-forward local `dev` from `origin/dev` before branch creation/merge, so `dev` always pulls latest remote changes first.
- Pre-commit guard blocks `agent/*` commits when staged files are unclaimed or claimed by another branch.
- Pre-commit guard blocks `agent/*` commits that stage `main.rs` without a valid main-rs lock for that same branch.

1. Explicit ownership before edits

- Assign each agent clear file/module ownership.
- Do not edit files outside your assigned scope unless the leader reassigns ownership.

2. No destructive rewrites of shared behavior

- Do not delete, replace, or “simplify away” critical paths (auth/session, proxy routes, production API wiring) without:
  - explicit user request or approved plan checkpoint, and
  - updated regression tests proving intended behavior.

3. Preserve parallel safety

- Assume other agents are editing nearby code concurrently.
- Never revert unrelated changes authored by others.
- If another change conflicts with your approach, adapt and report the conflict in handoff.

4. Verify before completion

- Run required local checks for the area you changed.
- For Rust runtime changes, minimum gate:
  - `bun run verify:rust-runtime-guardrails`
  - `cargo check -p codex-lb-runtime`
  - `cargo test -p codex-lb-runtime --no-run`
- Do not mark work complete without command output evidence.

5. Required handoff format (every agent)

- Files changed
- Behavior touched
- Verification commands + results
- Risks / follow-ups

6. Integration-first finalization

- Use one integrator pass before final completion to confirm:
  - no critical behavior was removed unintentionally,
  - ownership boundaries were respected,
  - session plan comments/handoffs were followed,
  - verification gates passed.

## Versioning Rule

## Workflow (OpenSpec-first)

This repo uses **OpenSpec as the primary workflow and SSOT** for change-driven development.

### How to work (default)

1. Find the relevant spec(s) in `openspec/specs/**` and treat them as source-of-truth.
2. If the work changes behavior, requirements, contracts, or schema: create an OpenSpec change in `openspec/changes/**` first (proposal -> tasks).
3. Implement the tasks; keep code + specs in sync (update `spec.md` as needed).
4. Validate specs locally: `openspec validate --specs`
5. When done: verify + archive the change (do not archive unverified changes).

### Source of Truth

- **Specs/Design/Tasks (SSOT)**: `openspec/`
  - Active changes: `openspec/changes/<change>/`
  - Main specs: `openspec/specs/<capability>/spec.md`
  - Archived changes: `openspec/changes/archive/YYYY-MM-DD-<change>/`

## Documentation & Release Notes

- **Do not add/update feature or behavior documentation under `docs/`**. Use OpenSpec context docs under `openspec/specs/<capability>/context.md` (or change-level context under `openspec/changes/<change>/context.md`) as the SSOT.
- **Do not edit `CHANGELOG.md` directly.** Leave changelog updates to the release process; record change notes in OpenSpec artifacts instead.

### Documentation Model (Spec + Context)

- `spec.md` is the **normative SSOT** and should contain only testable requirements.
- Use `openspec/specs/<capability>/context.md` for **free-form context** (purpose, rationale, examples, ops notes).
- If context grows, split into `overview.md`, `rationale.md`, `examples.md`, or `ops.md` within the same capability folder.
- Change-level notes live in `openspec/changes/<change>/context.md` or `notes.md`, then **sync stable context** back into the main context docs.

Prompting cue (use when writing docs):
"Keep `spec.md` strictly for requirements. Add/update `context.md` with purpose, decisions, constraints, failure modes, and at least one concrete example."

### Commands (recommended)

- Start a change: `/opsx:new <kebab-case>`
- Create/refresh plan workspace: `/opsx:plan <plan-slug>`
- Update plan checkpoint: `/opsx:checkpoint <plan-slug> <role> <checkpoint-id> <state> <text...>`
- Watch team -> plan checkpoints: `/opsx:watch-plan <team-name> <plan-slug>`
- Create artifacts (step): `/opsx:continue <change>`
- Create artifacts (fast): `/opsx:ff <change>`
- Implement tasks: `/opsx:apply <change>`
- Verify before archive: `/opsx:verify <change>`
- Sync delta specs → main specs: `/opsx:sync <change>`
- Archive: `/opsx:archive <change>`

## Plan Workspace Contract (`openspec/plan`)

Use `openspec/plan/` as the durable pre-implementation planning layer.

Planner narrative plans must follow `openspec/plan/PLANS.md`.

Required shape for each plan:

```text
openspec/plan/<plan-slug>/
  summary.md
  checkpoints.md
  planner/plan.md
  planner/tasks.md
  architect/tasks.md
  critic/tasks.md
  executor/tasks.md
  writer/tasks.md
  verifier/tasks.md
```

Role folders may additionally include `README.md`, notes, and evidence artifacts.

When operating in ralplan/team-style planning flows:

1. Create/maintain the plan workspace at `openspec/plan/<plan-slug>/`.
2. Ensure every participating role has a `tasks.md`.
3. Keep checklist sections visible in each `tasks.md`:
   - `## 1. Spec`
   - `## 2. Tests`
   - `## 3. Implementation`
   - `## 4. Checkpoints`
4. Update checkboxes during execution so status remains human-readable in OpenSpec style.

Scaffold command:

```bash
scripts/openspec/init-plan-workspace.sh <plan-slug>
```

<!-- multiagent-safety:START -->
<!-- AUTONOMY DIRECTIVE — DO NOT REMOVE -->
YOU ARE AN AUTONOMOUS CODING AGENT. EXECUTE TASKS TO COMPLETION WITHOUT ASKING FOR PERMISSION.
DO NOT STOP TO ASK "SHOULD I PROCEED?" — PROCEED. DO NOT WAIT FOR CONFIRMATION ON OBVIOUS NEXT STEPS.
IF BLOCKED, TRY AN ALTERNATIVE APPROACH. ONLY ASK WHEN TRULY AMBIGUOUS OR DESTRUCTIVE.
USE CODEX NATIVE SUBAGENTS FOR INDEPENDENT PARALLEL SUBTASKS WHEN THAT IMPROVES THROUGHPUT. THIS IS COMPLEMENTARY TO OMX TEAM MODE.
<!-- END AUTONOMY DIRECTIVE -->

# oh-my-codex - Intelligent Multi-Agent Orchestration

This AGENTS.md is the top-level operating contract for this repository.

## Operating principles

- Solve the task directly when possible.
- Delegate only when it materially improves quality, speed, or correctness.
- Keep progress short, concrete, and useful.
- Prefer evidence over assumption; verify before claiming completion.
- Use the lightest path that preserves quality.
- Check official docs before implementing with unfamiliar SDKs/APIs.

## Working agreements

- For cleanup/refactor/deslop work: write a cleanup plan first.
- Lock behavior with regression tests before cleanup edits when needed.
- Prefer deletion over addition.
- Reuse existing patterns before introducing new abstractions.
- No new dependencies without explicit request.
- Keep diffs small, reviewable, and reversible.
- Branching policy (always enforce):
  - Docs-only edits may be done directly on the active `main` branch (`README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `LICENSE`, and `docs/**`).
  - Any code/runtime/test/release/config change must be done on a new branch and merged to `main` only through a PR (never direct push to `main`).
  - For branch+merge flows, bump npm version and include updated `package.json` + lockfile in the merge.
- Run lint/typecheck/tests/static analysis after changes.
- Final reports must include: changed files, simplifications made, and remaining risks.

## Delegation rules

Default posture: work directly.

Mode guidance:
- Use deep interview for unclear requirements.
- Use ralplan for plan/tradeoff/test-shape consensus.
- Use team only for multi-lane coordinated execution.
- Use ralph only for persistent single-owner completion loops.
- Otherwise execute directly in solo mode.

## Verification

- Verify before claiming completion.
- Run dependent tasks sequentially.
- If verification fails, continue iterating instead of stopping early.
- Before concluding, confirm: no pending work, tests pass, no known errors, and evidence collected.

## Lore commit protocol

Commit messages should capture decision records using git trailers.

Recommended trailers:
- Constraint:
- Rejected:
- Confidence:
- Scope-risk:
- Reversibility:
- Directive:
- Tested:
- Not-tested:
- Related:

## Cancellation

Use cancel mode/workflow only when work is complete, user says stop, or a hard blocker prevents meaningful progress.

## State management

OMX runtime state typically lives under `.omx/`:
- `.omx/state/`
- `.omx/notepad.md`
- `.omx/project-memory.json`
- `.omx/plans/`
- `.omx/logs/`
<!-- multiagent-safety:END -->
