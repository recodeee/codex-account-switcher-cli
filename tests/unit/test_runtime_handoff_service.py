from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.core.exceptions import DashboardBadRequestError
from app.modules.handoffs.schemas import RuntimeHandoffCheckpoint, RuntimeHandoffCreateRequest, RuntimeHandoffResumeRequest
from app.modules.handoffs.service import RuntimeHandoffService

pytestmark = pytest.mark.unit


def _write_snapshot(accounts_dir: Path, name: str) -> None:
    accounts_dir.mkdir(parents=True, exist_ok=True)
    (accounts_dir / f"{name}.json").write_text(
        json.dumps({"email": f"{name}@example.com"}),
        encoding="utf-8",
    )


def test_create_and_resume_runtime_handoff(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    runtime_root = tmp_path / "runtimes"
    handoffs_dir = tmp_path / "handoffs"
    _write_snapshot(accounts_dir, "source")
    _write_snapshot(accounts_dir, "target")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    monkeypatch.setenv("CODEX_HANDOFFS_DIR", str(handoffs_dir))

    service = RuntimeHandoffService()
    created = service.create_handoff(
        RuntimeHandoffCreateRequest(
            source_runtime="terminal-a",
            source_snapshot="source",
            expected_target_snapshot="target",
            checkpoint=RuntimeHandoffCheckpoint(
                goal="Continue migration task",
                done=["Prepared schema"],
                next=["Wire API endpoints"],
            ),
        )
    )

    assert created.status.value == "ready"
    listed = service.list_handoffs()
    assert [entry.id for entry in listed] == [created.id]

    resumed, prompt = service.resume_handoff(
        created.id,
        RuntimeHandoffResumeRequest(
            target_runtime="terminal-b",
            target_snapshot="target",
        ),
    )
    assert resumed.status.value == "resumed"
    assert resumed.resume_count == 1
    assert "Continue migration task" in prompt
    assert resumed.target_runtime == "terminal-b"
    assert resumed.target_snapshot == "target"


def test_resume_rejects_snapshot_mismatch_without_override(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    accounts_dir = tmp_path / "accounts"
    _write_snapshot(accounts_dir, "source")
    _write_snapshot(accounts_dir, "expected")
    _write_snapshot(accounts_dir, "other")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_HANDOFFS_DIR", str(tmp_path / "handoffs"))

    service = RuntimeHandoffService()
    created = service.create_handoff(
        RuntimeHandoffCreateRequest(
            source_runtime="terminal-a",
            source_snapshot="source",
            expected_target_snapshot="expected",
            checkpoint=RuntimeHandoffCheckpoint(goal="Continue debugging"),
        )
    )

    with pytest.raises(DashboardBadRequestError, match="does not match expected"):
        service.resume_handoff(
            created.id,
            RuntimeHandoffResumeRequest(
                target_runtime="terminal-b",
                target_snapshot="other",
                override_mismatch=False,
            ),
        )

