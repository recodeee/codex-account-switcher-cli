from __future__ import annotations

import pytest
from sqlalchemy import text

from app.db.session import engine

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_workspaces_api_create_select_and_validation(async_client):
    initial = await async_client.get("/api/workspaces")
    assert initial.status_code == 200
    initial_payload = initial.json()
    assert len(initial_payload["entries"]) == 1
    default_workspace = initial_payload["entries"][0]
    assert default_workspace["name"] == "recodee.com"
    assert default_workspace["label"] == "Team"
    assert default_workspace["isActive"] is True

    created = await async_client.post(
        "/api/workspaces",
        json={"name": "My Team"},
    )
    assert created.status_code == 200
    created_payload = created.json()
    assert created_payload["name"] == "My Team"
    assert created_payload["slug"] == "my-team"
    assert created_payload["label"] == "Team"
    assert created_payload["isActive"] is True

    listed = await async_client.get("/api/workspaces")
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert len(listed_payload["entries"]) == 2
    active_workspace = next(entry for entry in listed_payload["entries"] if entry["isActive"])
    assert active_workspace["id"] == created_payload["id"]

    selected = await async_client.post(f"/api/workspaces/{default_workspace['id']}/select")
    assert selected.status_code == 200
    assert selected.json() == {"activeWorkspaceId": default_workspace["id"]}

    selected_list = await async_client.get("/api/workspaces")
    assert selected_list.status_code == 200
    selected_entries = selected_list.json()["entries"]
    assert next(entry for entry in selected_entries if entry["id"] == default_workspace["id"])["isActive"] is True
    assert next(entry for entry in selected_entries if entry["id"] == created_payload["id"])["isActive"] is False

    duplicate = await async_client.post(
        "/api/workspaces",
        json={"name": "My Team"},
    )
    assert duplicate.status_code == 409
    assert duplicate.json()["error"]["code"] == "workspace_name_exists"

    invalid = await async_client.post(
        "/api/workspaces",
        json={"name": "   "},
    )
    assert invalid.status_code == 400
    assert invalid.json()["error"]["code"] == "invalid_workspace_name"

    missing = await async_client.post("/api/workspaces/missing/select")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "workspace_not_found"


@pytest.mark.asyncio
async def test_workspaces_api_recovers_when_table_missing(async_client):
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS switchboard_workspaces"))

    listed = await async_client.get("/api/workspaces")
    assert listed.status_code == 200
    payload = listed.json()
    assert len(payload["entries"]) == 1
    assert payload["entries"][0]["name"] == "recodee.com"
    assert payload["entries"][0]["isActive"] is True

