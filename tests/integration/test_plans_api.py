from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_plans_api_lists_and_returns_detail(async_client):
    repo_root = Path(__file__).resolve().parents[2]
    plans_root = repo_root / "openspec" / "plan"
    slug = f"test-plan-{uuid4().hex[:8]}"
    plan_dir = plans_root / slug

    plan_dir.mkdir(parents=True, exist_ok=False)
    (plan_dir / "summary.md").write_text(
        "\n".join(
            [
                f"# Plan Summary: {slug}",
                "",
                "- **Mode:** ralplan",
                "- **Status:** draft",
                "",
                "## Context",
                "",
                "Test plan context",
                "",
            ]
        ),
        encoding="utf-8",
    )
    (plan_dir / "checkpoints.md").write_text(
        "\n".join(
            [
                f"# Plan Checkpoints: {slug}",
                "",
                "- 2026-04-08T00:00:00Z | role=planner | id=P1 | state=READY | boot",
                "",
            ]
        ),
        encoding="utf-8",
    )
    planner_dir = plan_dir / "planner"
    planner_dir.mkdir(parents=True, exist_ok=False)
    (planner_dir / "tasks.md").write_text(
        "\n".join(
            [
                "# planner tasks",
                "",
                "## 4. Checkpoints",
                "",
                "- [ ] [P1] READY - boot",
                "- [x] [P2] DONE - finalized",
                "",
            ]
        ),
        encoding="utf-8",
    )

    try:
        listed = await async_client.get("/api/projects/plans")
        assert listed.status_code == 200
        payload = listed.json()
        matching = [entry for entry in payload["entries"] if entry["slug"] == slug]
        assert len(matching) == 1
        assert matching[0]["status"] == "draft"
        assert matching[0]["roles"][0]["role"] == "planner"
        assert matching[0]["roles"][0]["totalCheckpoints"] == 2
        assert matching[0]["roles"][0]["doneCheckpoints"] == 1

        detail = await async_client.get(f"/api/projects/plans/{slug}")
        assert detail.status_code == 200
        detail_payload = detail.json()
        assert detail_payload["slug"] == slug
        assert detail_payload["status"] == "draft"
        assert "Plan Summary" in detail_payload["summaryMarkdown"]
        assert "Plan Checkpoints" in detail_payload["checkpointsMarkdown"]
        assert detail_payload["roles"][0]["role"] == "planner"
        assert detail_payload["roles"][0]["totalCheckpoints"] == 2
        assert detail_payload["roles"][0]["doneCheckpoints"] == 1
    finally:
        if plan_dir.exists():
            for candidate in sorted(plan_dir.rglob("*"), reverse=True):
                if candidate.is_file():
                    candidate.unlink()
                else:
                    candidate.rmdir()
            plan_dir.rmdir()


@pytest.mark.asyncio
async def test_plans_api_returns_not_found_for_missing_plan(async_client):
    response = await async_client.get("/api/projects/plans/missing-plan")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "plan_not_found"


@pytest.mark.asyncio
async def test_plans_api_detail_tolerates_missing_root_checkpoints(async_client):
    repo_root = Path(__file__).resolve().parents[2]
    plans_root = repo_root / "openspec" / "plan"
    slug = f"test-plan-no-checkpoints-{uuid4().hex[:8]}"
    plan_dir = plans_root / slug

    plan_dir.mkdir(parents=True, exist_ok=False)
    (plan_dir / "summary.md").write_text(
        "\n".join(
            [
                f"# Plan Summary: {slug}",
                "",
                "- **Mode:** ralplan",
                "- **Status:** approved",
                "",
                "## Context",
                "",
                "No root checkpoints file yet",
                "",
            ]
        ),
        encoding="utf-8",
    )
    planner_dir = plan_dir / "planner"
    planner_dir.mkdir(parents=True, exist_ok=False)
    (planner_dir / "tasks.md").write_text(
        "\n".join(
            [
                "# planner tasks",
                "",
                "## 4. Checkpoints",
                "",
                "- [x] [P1] DONE - boot",
                "",
            ]
        ),
        encoding="utf-8",
    )

    try:
        detail = await async_client.get(f"/api/projects/plans/{slug}")
        assert detail.status_code == 200
        payload = detail.json()
        assert payload["slug"] == slug
        assert payload["status"] == "approved"
        assert payload["checkpointsMarkdown"] == ""
        assert payload["roles"][0]["role"] == "planner"
    finally:
        if plan_dir.exists():
            for candidate in sorted(plan_dir.rglob("*"), reverse=True):
                if candidate.is_file():
                    candidate.unlink()
                else:
                    candidate.rmdir()
            plan_dir.rmdir()
