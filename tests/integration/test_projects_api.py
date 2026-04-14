from __future__ import annotations

from pathlib import Path

import pytest
from sqlalchemy import text

from app.db.session import engine

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_projects_api_crud_and_validation(async_client):
    initial = await async_client.get("/api/projects")
    assert initial.status_code == 200
    assert initial.json() == {"entries": []}

    created = await async_client.post(
        "/api/projects",
        json={
            "name": "recodee-core",
            "description": "Main dashboard project",
            "projectUrl": "marvahome.com",
            "projectPath": "/home/deadpool/projects/recodee-core",
            "sandboxMode": "workspace-write",
            "gitBranch": "feature/recodee-core",
        },
    )
    assert created.status_code == 200
    created_payload = created.json()
    assert created_payload["name"] == "recodee-core"
    assert created_payload["description"] == "Main dashboard project"
    assert created_payload["projectUrl"] == "https://marvahome.com"
    assert created_payload["projectPath"] == "/home/deadpool/projects/recodee-core"
    assert created_payload["sandboxMode"] == "workspace-write"
    assert created_payload["gitBranch"] == "feature/recodee-core"
    assert isinstance(created_payload["id"], str)

    listed = await async_client.get("/api/projects")
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert len(listed_payload["entries"]) == 1
    assert listed_payload["entries"][0]["id"] == created_payload["id"]

    second = await async_client.post(
        "/api/projects",
        json={
            "name": "ops",
            "description": "Operations project",
            "projectUrl": "https://ops.example.com",
            "projectPath": "/home/deadpool/projects/ops",
            "sandboxMode": "read-only",
            "gitBranch": None,
        },
    )
    assert second.status_code == 200
    second_payload = second.json()

    updated = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={
            "name": "recodee-core-v2",
            "description": "Updated description",
            "projectUrl": "recodee.com",
            "projectPath": "/home/deadpool/projects/recodee-core-v2",
            "sandboxMode": "danger-full-access",
            "gitBranch": "feature/recodee-core-v2",
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload["id"] == created_payload["id"]
    assert updated_payload["name"] == "recodee-core-v2"
    assert updated_payload["description"] == "Updated description"
    assert updated_payload["projectUrl"] == "https://recodee.com"
    assert updated_payload["projectPath"] == "/home/deadpool/projects/recodee-core-v2"
    assert updated_payload["sandboxMode"] == "danger-full-access"
    assert updated_payload["gitBranch"] == "feature/recodee-core-v2"

    update_duplicate_name = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": second_payload["name"], "description": "collision"},
    )
    assert update_duplicate_name.status_code == 409
    assert update_duplicate_name.json()["error"]["code"] == "project_name_exists"

    update_invalid_name = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": "   ", "description": "ignored"},
    )
    assert update_invalid_name.status_code == 400
    assert update_invalid_name.json()["error"]["code"] == "invalid_project_name"

    update_invalid_description = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": "valid-name", "description": "x" * 513},
    )
    assert update_invalid_description.status_code == 400
    assert update_invalid_description.json()["error"]["code"] == "invalid_project_description"

    update_invalid_path = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": "valid-name", "description": "desc", "projectPath": "./relative/path"},
    )
    assert update_invalid_path.status_code == 400
    assert update_invalid_path.json()["error"]["code"] == "invalid_project_path"

    update_invalid_sandbox = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": "valid-name", "description": "desc", "sandboxMode": "unknown"},
    )
    assert update_invalid_sandbox.status_code == 400
    assert update_invalid_sandbox.json()["error"]["code"] == "invalid_project_sandbox"

    update_invalid_branch = await async_client.put(
        f"/api/projects/{created_payload['id']}",
        json={"name": "valid-name", "description": "desc", "gitBranch": "../bad"},
    )
    assert update_invalid_branch.status_code == 400
    assert update_invalid_branch.json()["error"]["code"] == "invalid_project_branch"

    update_missing = await async_client.put(
        "/api/projects/missing-project",
        json={"name": "valid-name", "description": "desc"},
    )
    assert update_missing.status_code == 404
    assert update_missing.json()["error"]["code"] == "project_not_found"

    duplicate_name = await async_client.post(
        "/api/projects",
        json={"name": "recodee-core-v2", "description": "another project"},
    )
    assert duplicate_name.status_code == 409
    assert duplicate_name.json()["error"]["code"] == "project_name_exists"

    invalid_name = await async_client.post(
        "/api/projects",
        json={"name": "   ", "description": "invalid name"},
    )
    assert invalid_name.status_code == 400
    assert invalid_name.json()["error"]["code"] == "invalid_project_name"

    invalid_description = await async_client.post(
        "/api/projects",
        json={"name": "valid-name", "description": "x" * 513},
    )
    assert invalid_description.status_code == 400
    assert invalid_description.json()["error"]["code"] == "invalid_project_description"

    invalid_path = await async_client.post(
        "/api/projects",
        json={"name": "valid-name", "description": "desc", "projectPath": "relative/path"},
    )
    assert invalid_path.status_code == 400
    assert invalid_path.json()["error"]["code"] == "invalid_project_path"

    invalid_url = await async_client.post(
        "/api/projects",
        json={"name": "valid-name", "description": "desc", "projectUrl": "not a url"},
    )
    assert invalid_url.status_code == 400
    assert invalid_url.json()["error"]["code"] == "invalid_project_url"

    invalid_sandbox = await async_client.post(
        "/api/projects",
        json={"name": "valid-name", "description": "desc", "sandboxMode": "invalid"},
    )
    assert invalid_sandbox.status_code == 400
    assert invalid_sandbox.json()["error"]["code"] == "invalid_project_sandbox"

    invalid_branch = await async_client.post(
        "/api/projects",
        json={"name": "valid-name", "description": "desc", "gitBranch": "../bad"},
    )
    assert invalid_branch.status_code == 400
    assert invalid_branch.json()["error"]["code"] == "invalid_project_branch"

    deleted = await async_client.delete(f"/api/projects/{created_payload['id']}")
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted"}

    missing = await async_client.delete(f"/api/projects/{created_payload['id']}")
    assert missing.status_code == 404
    assert missing.json()["error"]["code"] == "project_not_found"


@pytest.mark.asyncio
async def test_projects_api_normalizes_empty_description_to_null(async_client):
    created = await async_client.post(
        "/api/projects",
        json={"name": "no-description-project", "description": "   "},
    )
    assert created.status_code == 200
    assert created.json()["description"] is None


@pytest.mark.asyncio
async def test_projects_api_defaults_sandbox_mode(async_client):
    created = await async_client.post(
        "/api/projects",
        json={"name": "defaults-project", "description": "Has defaults"},
    )
    assert created.status_code == 200
    payload = created.json()
    assert payload["projectUrl"] is None
    assert payload["projectPath"] is None
    assert payload["sandboxMode"] == "workspace-write"
    assert payload["gitBranch"] is None


@pytest.mark.asyncio
async def test_projects_api_normalizes_documents_shorthand_path(async_client):
    created = await async_client.post(
        "/api/projects",
        json={
            "name": "documents-shorthand-project",
            "projectPath": "/documents/szaloniroda/marva",
        },
    )
    assert created.status_code == 200
    assert created.json()["projectPath"] == str(Path.home() / "Documents" / "szaloniroda" / "marva")


@pytest.mark.asyncio
async def test_projects_api_open_folder(async_client, monkeypatch):
    created = await async_client.post(
        "/api/projects",
        json={
            "name": "open-folder-project",
            "projectPath": "/home/deadpool/Documents/recodee",
        },
    )
    assert created.status_code == 200
    project_id = created.json()["id"]

    def _fake_open(_path: str) -> str:
        return "code"

    monkeypatch.setattr(
        "app.modules.projects.api.open_project_folder_in_editor",
        _fake_open,
    )

    opened = await async_client.post(f"/api/projects/{project_id}/open-folder")
    assert opened.status_code == 200
    assert opened.json() == {
        "status": "opened",
        "projectPath": "/home/deadpool/Documents/recodee",
        "editor": "code",
    }


@pytest.mark.asyncio
async def test_projects_api_recovers_when_projects_table_missing(async_client):
    async with engine.begin() as conn:
        await conn.execute(text("DROP TABLE IF EXISTS projects"))

    listed = await async_client.get("/api/projects")
    assert listed.status_code == 200
    assert listed.json() == {"entries": []}

    created = await async_client.post(
        "/api/projects",
        json={"name": "recovered-project"},
    )
    assert created.status_code == 200
    assert created.json()["name"] == "recovered-project"


@pytest.mark.asyncio
async def test_projects_api_scopes_entries_by_active_workspace(async_client):
    default_workspaces = await async_client.get("/api/workspaces")
    assert default_workspaces.status_code == 200
    default_workspace = next(entry for entry in default_workspaces.json()["entries"] if entry["isActive"])

    created_default = await async_client.post(
        "/api/projects",
        json={"name": "shared-name", "description": "Default workspace project"},
    )
    assert created_default.status_code == 200
    default_project_id = created_default.json()["id"]

    created_workspace = await async_client.post("/api/workspaces", json={"name": "Other Team"})
    assert created_workspace.status_code == 200
    created_workspace_payload = created_workspace.json()
    assert created_workspace_payload["isActive"] is True

    listed_other_before = await async_client.get("/api/projects")
    assert listed_other_before.status_code == 200
    assert listed_other_before.json() == {"entries": []}

    created_other = await async_client.post(
        "/api/projects",
        json={"name": "shared-name", "description": "Other workspace project"},
    )
    assert created_other.status_code == 200
    other_project_id = created_other.json()["id"]

    listed_other = await async_client.get("/api/projects")
    assert listed_other.status_code == 200
    listed_other_entries = listed_other.json()["entries"]
    assert len(listed_other_entries) == 1
    assert listed_other_entries[0]["id"] == other_project_id
    assert listed_other_entries[0]["name"] == "shared-name"

    switch_back = await async_client.post(f"/api/workspaces/{default_workspace['id']}/select")
    assert switch_back.status_code == 200

    listed_default = await async_client.get("/api/projects")
    assert listed_default.status_code == 200
    listed_default_entries = listed_default.json()["entries"]
    assert len(listed_default_entries) == 1
    assert listed_default_entries[0]["id"] == default_project_id
    assert listed_default_entries[0]["name"] == "shared-name"

    delete_other_while_default_active = await async_client.delete(f"/api/projects/{other_project_id}")
    assert delete_other_while_default_active.status_code == 404
    assert delete_other_while_default_active.json()["error"]["code"] == "project_not_found"
