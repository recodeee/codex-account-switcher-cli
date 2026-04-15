from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db.session import engine

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_agents_api_crud_and_avatar_upload(async_client):
    initial = await async_client.get("/api/agents")
    assert initial.status_code == 200
    initial_payload = initial.json()
    initial_names = {entry["name"] for entry in initial_payload["entries"]}
    assert "Master Agent" in initial_names
    assert "Cleanup Agent" in initial_names

    created = await async_client.post(
        "/api/agents",
        json={
            "name": "DPQ",
            "description": "Handles runtime orchestration",
            "visibility": "private",
            "runtime": "Openclaw (openclaw-main)",
            "instructions": "",
            "maxConcurrentTasks": 8,
            "avatarDataUrl": "data:image/png;base64,aGVsbG8=",
            "environmentVariables": [
                {"key": "ANTHROPIC_API_KEY", "value": "token-1"},
                {"key": "ANTHROPIC_BASE_URL", "value": "https://api.anthropic.com"},
            ],
        },
    )
    assert created.status_code == 200
    created_payload = created.json()
    assert created_payload["name"] == "DPQ"
    assert created_payload["visibility"] == "private"
    assert created_payload["runtime"] == "Openclaw (openclaw-main)"
    assert created_payload["avatarDataUrl"] == "data:image/png;base64,aGVsbG8="
    assert created_payload["environmentVariables"] == [
        {"key": "ANTHROPIC_API_KEY", "value": "token-1"},
        {"key": "ANTHROPIC_BASE_URL", "value": "https://api.anthropic.com"},
    ]

    updated = await async_client.put(
        f"/api/agents/{created_payload['id']}",
        json={
            "name": "DPQ",
            "status": "idle",
            "description": "Handles runtime orchestration",
            "visibility": "private",
            "runtime": "Openclaw (openclaw-main)",
            "instructions": "Keep work scoped and verified",
            "maxConcurrentTasks": 8,
            "avatarDataUrl": "data:image/png;base64,aGVsbG8=",
            "environmentVariables": [
                {"key": "ANTHROPIC_API_KEY", "value": "token-2"},
                {"key": "ANTHROPIC_BASE_URL", "value": "https://proxy.local"},
            ],
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload["avatarDataUrl"] == "data:image/png;base64,aGVsbG8="
    assert updated_payload["environmentVariables"] == [
        {"key": "ANTHROPIC_API_KEY", "value": "token-2"},
        {"key": "ANTHROPIC_BASE_URL", "value": "https://proxy.local"},
    ]

    listed = await async_client.get("/api/agents")
    assert listed.status_code == 200
    listed_entries = listed.json()["entries"]
    listed_dpq = next(entry for entry in listed_entries if entry["id"] == created_payload["id"])
    assert listed_dpq["avatarDataUrl"] == "data:image/png;base64,aGVsbG8="
    assert listed_dpq["environmentVariables"] == [
        {"key": "ANTHROPIC_API_KEY", "value": "token-2"},
        {"key": "ANTHROPIC_BASE_URL", "value": "https://proxy.local"},
    ]

    invalid_avatar = await async_client.put(
        f"/api/agents/{created_payload['id']}",
        json={
            "name": "DPQ",
            "status": "idle",
            "description": "Handles runtime orchestration",
            "visibility": "private",
            "runtime": "Openclaw (openclaw-main)",
            "instructions": "Keep work scoped and verified",
            "maxConcurrentTasks": 8,
            "avatarDataUrl": "not-a-data-url",
        },
    )
    assert invalid_avatar.status_code == 400
    assert invalid_avatar.json()["error"]["code"] == "invalid_agent_avatar"

    invalid_environment_key = await async_client.put(
        f"/api/agents/{created_payload['id']}",
        json={
            "name": "DPQ",
            "status": "idle",
            "description": "Handles runtime orchestration",
            "visibility": "private",
            "runtime": "Openclaw (openclaw-main)",
            "instructions": "Keep work scoped and verified",
            "maxConcurrentTasks": 8,
            "avatarDataUrl": "data:image/png;base64,aGVsbG8=",
            "environmentVariables": [{"key": "BAD-KEY", "value": "x"}],
        },
    )
    assert invalid_environment_key.status_code == 400
    assert invalid_environment_key.json()["error"]["code"] == "invalid_agent_environment_variables"

    deleted = await async_client.delete(f"/api/agents/{created_payload['id']}")
    assert deleted.status_code == 204

    missing = await async_client.delete("/api/agents/missing")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "agent_not_found"


@pytest.mark.asyncio
async def test_agents_api_recovers_when_table_missing(async_client):
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS switchboard_agents"))

    listed = await async_client.get("/api/agents")
    assert listed.status_code == 200
    payload = listed.json()
    names = {entry["name"] for entry in payload["entries"]}
    assert names == {"Master Agent", "Cleanup Agent"}
