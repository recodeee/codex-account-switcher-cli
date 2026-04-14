from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_skill_guard_module():
    repo_root = Path(__file__).resolve().parents[2]
    module_path = repo_root / ".agents" / "hooks" / "skill_guard.py"
    spec = importlib.util.spec_from_file_location("skill_guard", module_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ensure_protected_branch_edit_allowed_blocks_protected_branch_without_codex_env(
    monkeypatch,
) -> None:
    skill_guard = _load_skill_guard_module()
    monkeypatch.delenv("CODEX_THREAD_ID", raising=False)
    monkeypatch.delenv("OMX_SESSION_ID", raising=False)
    monkeypatch.setenv("CODEX_CI", "0")
    monkeypatch.delenv(skill_guard.PROTECTED_BRANCH_EDIT_OVERRIDE_ENV, raising=False)

    monkeypatch.setattr(skill_guard, "find_repo_root", lambda _path: Path("/tmp/repo"))
    monkeypatch.setattr(skill_guard, "current_branch", lambda _root: "dev")

    error = skill_guard.ensure_protected_branch_edit_allowed(
        "app/modules/accounts/codex_live_usage.py"
    )

    assert error is not None
    assert "protected branch 'dev'" in error


def test_ensure_protected_branch_edit_allowed_allows_override(monkeypatch) -> None:
    skill_guard = _load_skill_guard_module()
    monkeypatch.setenv(skill_guard.PROTECTED_BRANCH_EDIT_OVERRIDE_ENV, "1")
    monkeypatch.setattr(skill_guard, "find_repo_root", lambda _path: Path("/tmp/repo"))
    monkeypatch.setattr(skill_guard, "current_branch", lambda _root: "dev")

    error = skill_guard.ensure_protected_branch_edit_allowed(
        "app/modules/accounts/codex_live_usage.py"
    )

    assert error is None


def test_ensure_protected_branch_edit_allowed_blocks_codex_on_non_agent_branch(
    monkeypatch,
) -> None:
    skill_guard = _load_skill_guard_module()
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-123")
    monkeypatch.delenv("OMX_SESSION_ID", raising=False)
    monkeypatch.setenv("CODEX_CI", "0")
    monkeypatch.delenv(skill_guard.PROTECTED_BRANCH_EDIT_OVERRIDE_ENV, raising=False)
    monkeypatch.setattr(skill_guard, "find_repo_root", lambda _path: Path("/tmp/repo"))
    monkeypatch.setattr(skill_guard, "current_branch", lambda _root: "feature/new-ui")

    error = skill_guard.ensure_protected_branch_edit_allowed(
        "apps/frontend/src/features/projects/components/projects-page.tsx"
    )

    assert error is not None
    assert "non-agent branch 'feature/new-ui'" in error


def test_ensure_protected_branch_edit_allowed_allows_codex_on_agent_branch(
    monkeypatch,
) -> None:
    skill_guard = _load_skill_guard_module()
    monkeypatch.setenv("CODEX_THREAD_ID", "thread-456")
    monkeypatch.delenv("OMX_SESSION_ID", raising=False)
    monkeypatch.setenv("CODEX_CI", "0")
    monkeypatch.delenv(skill_guard.PROTECTED_BRANCH_EDIT_OVERRIDE_ENV, raising=False)
    monkeypatch.setattr(skill_guard, "find_repo_root", lambda _path: Path("/tmp/repo"))
    monkeypatch.setattr(skill_guard, "current_branch", lambda _root: "agent/executor/demo-task")

    error = skill_guard.ensure_protected_branch_edit_allowed(
        "apps/frontend/src/features/projects/components/projects-page.tsx"
    )

    assert error is None


def test_ensure_protected_branch_edit_allowed_allows_non_codex_non_protected_branch(
    monkeypatch,
) -> None:
    skill_guard = _load_skill_guard_module()
    monkeypatch.delenv("CODEX_THREAD_ID", raising=False)
    monkeypatch.delenv("OMX_SESSION_ID", raising=False)
    monkeypatch.setenv("CODEX_CI", "0")
    monkeypatch.delenv(skill_guard.PROTECTED_BRANCH_EDIT_OVERRIDE_ENV, raising=False)
    monkeypatch.setattr(skill_guard, "find_repo_root", lambda _path: Path("/tmp/repo"))
    monkeypatch.setattr(skill_guard, "current_branch", lambda _root: "feature/manual-edit")

    error = skill_guard.ensure_protected_branch_edit_allowed(
        "apps/frontend/src/features/projects/components/projects-page.tsx"
    )

    assert error is None
