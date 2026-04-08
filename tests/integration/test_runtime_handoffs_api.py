from __future__ import annotations

import json
from pathlib import Path

import pytest

pytestmark = pytest.mark.integration


def _write_snapshot(accounts_dir: Path, name: str) -> None:
    accounts_dir.mkdir(parents=True, exist_ok=True)
    (accounts_dir / f"{name}.json").write_text(
        json.dumps({"email": f"{name}@example.com"}),
        encoding="utf-8",
    )


@pytest.mark.asyncio
async def test_runtime_handoff_create_list_resume_flow(async_client, monkeypatch, tmp_path):
    accounts_dir = tmp_path / "accounts"
    handoffs_dir = tmp_path / "handoffs"
    _write_snapshot(accounts_dir, "source")
    _write_snapshot(accounts_dir, "target")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_HANDOFFS_DIR", str(handoffs_dir))

    create_payload = {
        "sourceRuntime": "terminal-a",
        "sourceSnapshot": "source",
        "expectedTargetSnapshot": "target",
        "checkpoint": {
            "goal": "Finish larger refactor after quota cap",
            "done": ["Implemented parser"],
            "next": ["Add mapper tests"],
        },
    }
    create_response = await async_client.post("/api/runtime-handoffs", json=create_payload)
    assert create_response.status_code == 200
    created = create_response.json()
    assert created["status"] == "ready"
    handoff_id = created["id"]

    list_response = await async_client.get("/api/runtime-handoffs")
    assert list_response.status_code == 200
    listed = list_response.json()
    assert listed["total"] == 1
    assert listed["entries"][0]["id"] == handoff_id

    resume_response = await async_client.post(
        f"/api/runtime-handoffs/{handoff_id}/resume",
        json={
            "targetRuntime": "terminal-b",
            "targetSnapshot": "target",
            "overrideMismatch": False,
        },
    )
    assert resume_response.status_code == 200
    resumed = resume_response.json()
    assert resumed["handoff"]["status"] == "resumed"
    assert resumed["handoff"]["targetRuntime"] == "terminal-b"
    assert resumed["handoff"]["targetSnapshot"] == "target"
    assert "Finish larger refactor" in resumed["resumePrompt"]

