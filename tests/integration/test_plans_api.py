from __future__ import annotations

from pathlib import Path
from uuid import uuid4

import pytest

from app.modules.plans.api import get_plans_service
from app.modules.plans.service import OpenSpecPlansService

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
                "- 2026-04-08T00:00:00Z | role=planner | id=P1 | state=DONE | planning complete",
                "- 2026-04-08T00:15:00Z | role=executor | id=E1 | state=IN_PROGRESS | implementing role progress",
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
    executor_dir = plan_dir / "executor"
    executor_dir.mkdir(parents=True, exist_ok=False)
    (executor_dir / "tasks.md").write_text(
        "\n".join(
            [
                "# executor tasks",
                "",
                "## 4. Checkpoints",
                "",
                "- [ ] [E1] IN_PROGRESS - implement detail panel",
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
        assert matching[0]["roles"][-1]["role"] == "designer"
        assert matching[0]["roles"][-1]["totalCheckpoints"] == 0
        assert matching[0]["roles"][-1]["doneCheckpoints"] == 0
        assert matching[0]["overallProgress"]["totalCheckpoints"] == 3
        assert matching[0]["overallProgress"]["doneCheckpoints"] == 1
        assert matching[0]["overallProgress"]["percentComplete"] == 33
        assert matching[0]["currentCheckpoint"]["role"] == "executor"
        assert matching[0]["currentCheckpoint"]["checkpointId"] == "E1"
        assert matching[0]["currentCheckpoint"]["state"] == "IN_PROGRESS"
        assert matching[0]["currentCheckpoint"]["message"] == "implementing role progress"

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
        assert detail_payload["roles"][-1]["role"] == "designer"
        assert detail_payload["roles"][-1]["totalCheckpoints"] == 0
        assert detail_payload["roles"][-1]["doneCheckpoints"] == 0
        assert detail_payload["overallProgress"]["percentComplete"] == 33
        assert detail_payload["currentCheckpoint"]["role"] == "executor"
        assert detail_payload["currentCheckpoint"]["checkpointId"] == "E1"
        assert detail_payload["currentCheckpoint"]["state"] == "IN_PROGRESS"
        assert (
            detail_payload["currentCheckpoint"]["message"]
            == "implementing role progress"
        )
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
async def test_plans_api_rejects_path_traversal_slug(async_client, app_instance, tmp_path):
    plans_root_parent = tmp_path / "plans-root"
    plans_root = plans_root_parent / "plan"
    plans_root.mkdir(parents=True, exist_ok=False)
    escaped_summary_path = plans_root_parent / "summary.md"
    escaped_checkpoints_path = plans_root_parent / "checkpoints.md"
    escaped_summary_path.write_text(
        "# Plan Summary: escaped-parent\n\n- **Status:** approved\n",
        encoding="utf-8",
    )
    escaped_checkpoints_path.write_text("# Plan Checkpoints: escaped-parent\n", encoding="utf-8")
    app_instance.dependency_overrides[get_plans_service] = lambda: OpenSpecPlansService(plans_root=plans_root)

    try:
        response = await async_client.get("/api/projects/plans/%2E%2E")
        assert response.status_code == 404
        assert response.json()["error"]["code"] == "plan_not_found"
    finally:
        app_instance.dependency_overrides.pop(get_plans_service, None)


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


@pytest.mark.asyncio
async def test_plans_api_runtime_observer_returns_live_payload(async_client, app_instance, tmp_path):
    plans_root = tmp_path / "openspec" / "plan"
    plan_slug = "plans-live-execution-observer"
    plan_dir = plans_root / plan_slug
    plan_dir.mkdir(parents=True, exist_ok=False)
    (plan_dir / "summary.md").write_text(
        "\n".join(
            [
                f"# Plan Summary: {plan_slug}",
                "",
                "- **Status:** approved",
            ]
        ),
        encoding="utf-8",
    )

    session_id = "019d6cae-f82e-7670-a403-b5fae5c6e85c"
    (plan_dir / ".omx-session.json").write_text(
        '{"sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c"}',
        encoding="utf-8",
    )

    omx_root = tmp_path / ".omx"
    session_dir = omx_root / "state" / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=False)
    (session_dir / "ralplan-state.json").write_text(
        "\n".join(
            [
                "{",
                '  "mode": "ralplan",',
                '  "current_phase": "planning",',
                '  "active": true,',
                '  "updated_at": "2026-04-08T12:54:00Z"',
                "}",
            ]
        ),
        encoding="utf-8",
    )
    (session_dir / "ralplan-agent-events.jsonl").write_text(
        "\n".join(
            [
                (
                    '{"ts":"2026-04-08T12:50:00Z","eventType":"agent_spawned","sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c",'
                    '"source":"ralplan-runtime","authoritative":true,"agentName":"planner","role":"planner",'
                    '"model":"gpt-5.3-codex","status":"running","message":"Planner spawned"}'
                ),
                (
                    '{"ts":"2026-04-08T12:52:00Z","eventType":"agent_waiting","sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c",'
                    '"source":"ralplan-runtime","authoritative":true,"agentName":"planner","role":"planner",'
                    '"model":"gpt-5.3-codex","status":"waiting","message":"Waiting architect review"}'
                ),
            ]
        ),
        encoding="utf-8",
    )
    (session_dir / "ralplan-resume-state.json").write_text(
        "\n".join(
            [
                "{",
                '  "planSlug": "plans-live-execution-observer",',
                '  "updatedAt": "2026-04-08T12:54:00Z",',
                '  "resumable": true,',
                '  "lastCheckpoint": {',
                '    "timestamp": "2026-04-08T12:54:00Z",',
                '    "role": "critic",',
                '    "checkpointId": "C1",',
                '    "state": "DONE",',
                '    "message": "Critic approved handoff"',
                "  },",
                '  "lastError": {',
                '    "timestamp": "2026-04-08T12:53:15Z",',
                '    "code": "account_limit_hit",',
                '    "message": "Quota exhausted on runtime lane",',
                '    "source": "runtime",',
                '    "recoverable": true',
                "  }",
                "}",
            ]
        ),
        encoding="utf-8",
    )
    logs_dir = omx_root / "logs"
    logs_dir.mkdir(parents=True, exist_ok=False)
    (logs_dir / "omx-2026-04-08.jsonl").write_text(
        (
            '{"event":"session_start","session_id":"019d6cae-f82e-7670-a403-b5fae5c6e85c",'
            '"timestamp":"2026-04-08T12:40:00Z"}\n'
        ),
        encoding="utf-8",
    )

    app_instance.dependency_overrides[get_plans_service] = (
        lambda: OpenSpecPlansService(plans_root=plans_root, omx_root=omx_root)
    )
    try:
        response = await async_client.get(f"/api/projects/plans/{plan_slug}/runtime")
        assert response.status_code == 200
        payload = response.json()
        assert payload["available"] is True
        assert payload["sessionId"] == session_id
        assert payload["correlationConfidence"] == "high"
        assert payload["mode"] == "ralplan"
        assert payload["phase"] == "planning"
        assert payload["active"] is True
        assert payload["staleAfterSeconds"] == 5
        assert payload["partial"] is False
        assert payload["unavailableReason"] is None
        assert payload["canResume"] is True
        assert payload["lastCheckpoint"]["checkpointId"] == "C1"
        assert payload["lastError"]["code"] == "account_limit_hit"
        assert payload["agents"][0]["name"] == "planner"
        assert payload["agents"][0]["model"] == "gpt-5.3-codex"
        kinds = [entry["kind"] for entry in payload["events"]]
        assert "agent_spawned" in kinds
        assert "session_start" in kinds
    finally:
        app_instance.dependency_overrides.pop(get_plans_service, None)


@pytest.mark.asyncio
async def test_plans_api_runtime_observer_fails_closed_when_agent_events_missing(async_client, app_instance, tmp_path):
    plans_root = tmp_path / "openspec" / "plan"
    plan_slug = "plans-live-execution-observer"
    plan_dir = plans_root / plan_slug
    plan_dir.mkdir(parents=True, exist_ok=False)
    (plan_dir / "summary.md").write_text(
        f"# Plan Summary: {plan_slug}\n\n- **Status:** approved\n",
        encoding="utf-8",
    )
    (plan_dir / ".omx-session.json").write_text(
        '{"sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c"}',
        encoding="utf-8",
    )

    omx_root = tmp_path / ".omx"
    session_id = "019d6cae-f82e-7670-a403-b5fae5c6e85c"
    session_dir = omx_root / "state" / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=False)
    (session_dir / "ralplan-state.json").write_text(
        '{"mode":"ralplan","current_phase":"planning","active":false,"updated_at":"2026-04-08T12:54:00Z"}',
        encoding="utf-8",
    )

    app_instance.dependency_overrides[get_plans_service] = (
        lambda: OpenSpecPlansService(plans_root=plans_root, omx_root=omx_root)
    )
    try:
        response = await async_client.get(f"/api/projects/plans/{plan_slug}/runtime")
        assert response.status_code == 200
        payload = response.json()
        assert payload["available"] is False
        assert payload["partial"] is True
        assert payload["agents"] == []
        assert payload["events"] == []
        assert "agent_events_missing" in payload["reasons"]
        assert payload["unavailableReason"] == "agent_events_missing"
        assert payload["staleAfterSeconds"] == 30
    finally:
        app_instance.dependency_overrides.pop(get_plans_service, None)


@pytest.mark.asyncio
async def test_plans_api_runtime_observer_requires_authoritative_session_scoped_events(async_client, app_instance, tmp_path):
    plans_root = tmp_path / "openspec" / "plan"
    plan_slug = "plans-live-execution-observer"
    plan_dir = plans_root / plan_slug
    plan_dir.mkdir(parents=True, exist_ok=False)
    (plan_dir / "summary.md").write_text(
        f"# Plan Summary: {plan_slug}\n\n- **Status:** approved\n",
        encoding="utf-8",
    )
    session_id = "019d6cae-f82e-7670-a403-b5fae5c6e85c"
    (plan_dir / ".omx-session.json").write_text(
        '{"sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c"}',
        encoding="utf-8",
    )

    omx_root = tmp_path / ".omx"
    session_dir = omx_root / "state" / "sessions" / session_id
    session_dir.mkdir(parents=True, exist_ok=False)
    (session_dir / "ralplan-state.json").write_text(
        '{"mode":"ralplan","current_phase":"planning","active":true,"updated_at":"2026-04-08T12:54:00Z"}',
        encoding="utf-8",
    )
    (session_dir / "ralplan-agent-events.jsonl").write_text(
        "\n".join(
            [
                (
                    '{"ts":"2026-04-08T12:50:00Z","eventType":"agent_spawned","sessionId":"019d6cae-f82e-7670-a403-b5fae5c6e85c",'
                    '"source":"ralplan-runtime","authoritative":false,"agentName":"planner","role":"planner",'
                    '"model":"gpt-5.3-codex","status":"running","message":"non-authoritative sample"}'
                ),
                (
                    '{"ts":"2026-04-08T12:51:00Z","eventType":"agent_spawned","source":"ralplan-runtime","authoritative":true,'
                    '"agentName":"architect","role":"architect","model":"gpt-5.3-codex","status":"running","message":"missing session id"}'
                ),
            ]
        ),
        encoding="utf-8",
    )

    app_instance.dependency_overrides[get_plans_service] = (
        lambda: OpenSpecPlansService(plans_root=plans_root, omx_root=omx_root)
    )
    try:
        response = await async_client.get(f"/api/projects/plans/{plan_slug}/runtime")
        assert response.status_code == 200
        payload = response.json()
        assert payload["available"] is False
        assert payload["partial"] is True
        assert payload["agents"] == []
        assert payload["events"] == []
        assert "agent_events_invalid" in payload["reasons"]
        assert payload["unavailableReason"] == "agent_events_invalid"
    finally:
        app_instance.dependency_overrides.pop(get_plans_service, None)
