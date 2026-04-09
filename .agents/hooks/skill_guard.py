#!/usr/bin/env python3
"""PreToolUse hook — enforce guardrail skills before Edit/Write operations."""

import json
import os
import re
import subprocess
import sys
import time
from fnmatch import fnmatch
from pathlib import Path

try:
    from _analytics import emit_event
except ImportError:

    def emit_event(*_a: object, **_k: object) -> None:
        pass


MAIN_RS_REL_PATH = "rust/codex-lb-runtime/src/main.rs"
MAIN_RS_LOCK_REL_PATH = ".omx/locks/rust-main-rs.lock.json"
PROTECTED_BRANCHES = {"dev", "main", "master"}


def load_skill_rules() -> dict:
    """Load skill-rules.json relative to this hook's location."""
    hook_dir = Path(__file__).resolve().parent
    rules_path = hook_dir.parent / "skills" / "skill-rules.json"
    with open(rules_path) as f:
        return json.load(f)


def load_session_state(session_id: str) -> dict:
    """Load session state for tracking which skills have been used."""
    hook_dir = Path(__file__).resolve().parent
    state_path = hook_dir / "state" / f"skills-used-{session_id}.json"
    if state_path.exists():
        try:
            with open(state_path) as f:
                return json.load(f)
        except (json.JSONDecodeError, ValueError):
            pass
    return {"suggestedSkills": [], "usedSkills": []}


def match_path_patterns(file_path: str, patterns: list[str]) -> bool:
    """Check if file_path matches any glob pattern."""
    return any(fnmatch(file_path, pat) for pat in patterns)


def match_content_patterns(file_path: str, patterns: list[str]) -> bool:
    """Check if file content matches any regex pattern."""
    try:
        content = Path(file_path).read_text(errors="ignore")
        return any(re.search(pat, content) for pat in patterns)
    except (FileNotFoundError, PermissionError):
        return False


def check_pass_state(pass_state_file: str) -> bool:
    """Check if a pass state file exists and has result=PASS."""
    hook_dir = Path(__file__).resolve().parent
    state_path = hook_dir / "state" / pass_state_file
    if not state_path.exists():
        return False
    try:
        data = json.loads(state_path.read_text())
        return data.get("result") == "PASS"
    except (json.JSONDecodeError, PermissionError):
        return False


def check_file_markers(file_path: str, markers: list[str]) -> bool:
    """Check if file contains any skip markers."""
    try:
        content = Path(file_path).read_text(errors="ignore")
        return any(marker in content for marker in markers)
    except (FileNotFoundError, PermissionError):
        return False


def find_repo_root(file_path: str) -> Path:
    """Resolve repository root by walking up from file path until .git is found."""
    candidate = Path(file_path).resolve()
    for parent in [candidate, *candidate.parents]:
        git_dir = parent / ".git"
        if git_dir.exists():
            return parent
    return Path.cwd()


def normalize_path(value: str) -> str:
    return value.replace("\\", "/")


def current_branch(repo_root: Path) -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=repo_root,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def ensure_main_rs_lock(file_path: str, session_id: str) -> str | None:
    """Return an error message when main.rs lock is missing/owned by another session."""
    if not normalize_path(file_path).endswith(MAIN_RS_REL_PATH):
        return None

    repo_root = find_repo_root(file_path)
    branch = current_branch(repo_root)
    if branch in PROTECTED_BRANCHES and os.environ.get("ALLOW_MAIN_RS_EDIT_ON_PROTECTED_BRANCH") != "1":
        return (
            f"BLOCKED: main.rs edits are not allowed on protected branch '{branch}'.\n"
            "Use agent branch/worktree first:\n"
            '  bash scripts/agent-branch-start.sh "<task>" "<agent-name>"'
        )

    lock_path = repo_root / MAIN_RS_LOCK_REL_PATH
    if not lock_path.exists():
        return (
            "BLOCKED: rust/codex-lb-runtime/src/main.rs requires an ownership lock.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" "
            f'--branch "{branch or "<agent-branch>"}"'
        )

    try:
        lock_data = json.loads(lock_path.read_text())
    except (json.JSONDecodeError, OSError):
        return (
            "BLOCKED: rust main.rs lock file is unreadable.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" --force"
        )

    expires_at_epoch = lock_data.get("expires_at_epoch")
    if isinstance(expires_at_epoch, (int, float)) and time.time() > float(expires_at_epoch):
        return (
            "BLOCKED: rust main.rs lock is expired.\n"
            "Run: python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\""
        )

    owner_branch = lock_data.get("owner_branch")
    if owner_branch and branch and owner_branch != branch:
        owner_label = lock_data.get("owner") or owner_branch
        return (
            f"BLOCKED: rust main.rs lock is owned by branch '{owner_branch}' ({owner_label}).\n"
            f"Current branch: '{branch}'.\n"
            "Status: python3 scripts/main_rs_lock.py status"
        )

    if not owner_branch:
        return (
            "BLOCKED: rust main.rs lock is legacy/missing owner_branch.\n"
            "Re-claim with branch ownership:\n"
            "  python3 scripts/main_rs_lock.py claim --owner \"<agent-name>\" "
            f'--branch "{branch or "<agent-branch>"}" --force'
        )

    owner_session_id = lock_data.get("owner_session_id")
    if not owner_session_id:
        return None
    if owner_session_id == session_id:
        return None

    owner_label = lock_data.get("owner") or owner_branch or "unknown owner"
    return (
        f"BLOCKED: rust main.rs lock is currently owned by {owner_label} on branch '{owner_branch}'.\n"
        "Use a different file/module or wait for release.\n"
        "Status: python3 scripts/main_rs_lock.py status"
    )


def main() -> None:
    try:
        input_data = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, EOFError):
        sys.exit(0)  # fail-open

    session_id = input_data.get("session_id", "unknown")
    tool_input = input_data.get("tool_input", {})
    file_path = tool_input.get("file_path", "")

    if not file_path:
        sys.exit(0)

    lock_error = ensure_main_rs_lock(file_path, session_id)
    if lock_error:
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "main_rs_locked",
                "matched_count": 1,
                "exit_code": 2,
            },
        )
        print(lock_error, file=sys.stderr)
        sys.exit(2)

    try:
        rules = load_skill_rules()
    except (FileNotFoundError, json.JSONDecodeError):
        sys.exit(0)  # fail-open

    skills = rules.get("skills", {})

    session_state = load_session_state(session_id)

    # --- Phase 1: Hard block guardrails ---
    guardrails = {
        name: rule
        for name, rule in skills.items()
        if rule.get("type") == "guardrail" and rule.get("enforcement") == "block"
    }

    for name, rule in guardrails.items():
        file_triggers = rule.get("fileTriggers")
        if not file_triggers:
            continue

        path_patterns = file_triggers.get("pathPatterns", [])
        if not match_path_patterns(file_path, path_patterns):
            continue

        path_exclusions = file_triggers.get("pathExclusions", [])
        if path_exclusions and match_path_patterns(file_path, path_exclusions):
            continue

        content_patterns = file_triggers.get("contentPatterns", [])
        if content_patterns and not match_content_patterns(file_path, content_patterns):
            continue

        # --- Skip conditions ---
        skip = rule.get("skipConditions", {})

        pass_state_file = skip.get("passStateFile")
        if pass_state_file and check_pass_state(pass_state_file):
            continue

        if skip.get("sessionSkillUsed") and name in session_state.get("usedSkills", []):
            continue

        file_markers = skip.get("fileMarkers", [])
        if file_markers and check_file_markers(file_path, file_markers):
            continue

        env_override = skip.get("envOverride")
        if env_override and os.environ.get(env_override):
            continue

        # All checks passed — block
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "blocked",
                "matched_count": 1,
                "exit_code": 2,
            },
        )
        block_message = rule.get(
            "blockMessage",
            f"BLOCKED: Skill '{name}' must be invoked before editing this file.\nUse Skill tool: '{name}'",
        )
        print(block_message, file=sys.stderr)
        sys.exit(2)

    # --- Phase 2: Remind enforcement (block until skill invoked in session) ---
    remind_rules = {
        name: rule for name, rule in skills.items() if rule.get("enforcement") == "remind" and rule.get("fileTriggers")
    }

    for name, rule in remind_rules.items():
        file_triggers = rule.get("fileTriggers", {})

        path_patterns = file_triggers.get("pathPatterns", [])
        if not match_path_patterns(file_path, path_patterns):
            continue

        path_exclusions = file_triggers.get("pathExclusions", [])
        if path_exclusions and match_path_patterns(file_path, path_exclusions):
            continue

        content_patterns = file_triggers.get("contentPatterns", [])
        if content_patterns and not match_content_patterns(file_path, content_patterns):
            continue

        # --- Skip conditions ---
        skip = rule.get("skipConditions", {})

        if skip.get("sessionSkillUsed") and name in session_state.get("usedSkills", []):
            continue

        env_override = skip.get("envOverride")
        if env_override and os.environ.get(env_override):
            continue

        # Block with convention reminder
        emit_event(
            session_id,
            "hook.invoked",
            {
                "hook": "skill_guard",
                "trigger": "PreToolUse",
                "outcome": "remind_blocked",
                "matched_count": 1,
                "exit_code": 2,
            },
        )
        block_message = rule.get(
            "blockMessage",
            f"BLOCKED: Run /{name} first.\n"
            f"You must invoke this skill before editing this file.\n\n"
            f"→ Skill tool: '{name}'",
        )
        print(block_message, file=sys.stderr)
        sys.exit(2)

    emit_event(
        session_id,
        "hook.invoked",
        {
            "hook": "skill_guard",
            "trigger": "PreToolUse",
            "outcome": "passed",
            "matched_count": 0,
            "exit_code": 0,
        },
    )
    sys.exit(0)


if __name__ == "__main__":
    main()
