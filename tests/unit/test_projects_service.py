from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import cast

import pytest

from app.modules.projects.repository import ProjectRepositoryConflictError
from app.modules.projects.service import (
    AutoDiscoveredGitProject,
    DEFAULT_SANDBOX_MODE,
    ProjectNameExistsError,
    ProjectPathExistsError,
    ProjectsRepositoryPort,
    ProjectsService,
    ProjectValidationError,
    discover_active_codex_git_projects,
    normalize_git_branch,
    normalize_github_repo_url,
    normalize_project_description,
    normalize_project_path,
    normalize_project_name,
    normalize_project_url,
    normalize_sandbox_mode,
)

pytestmark = pytest.mark.unit


@dataclass(slots=True)
class _Entry:
    id: str
    name: str
    description: str | None
    project_url: str | None
    github_repo_url: str | None
    project_path: str | None
    sandbox_mode: str
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


class _Repo:
    def __init__(self) -> None:
        self._entries: dict[str, _Entry] = {}

    async def list_entries(self) -> Sequence[_Entry]:
        return sorted(self._entries.values(), key=lambda entry: (entry.created_at, entry.name))

    async def get_entry(self, project_id: str) -> _Entry | None:
        return self._entries.get(project_id)

    async def exists_name(self, name: str) -> bool:
        return any(entry.name == name for entry in self._entries.values())

    async def exists_path(
        self,
        project_path: str,
        *,
        exclude_project_id: str | None = None,
    ) -> bool:
        return any(
            entry.project_path == project_path and entry.id != exclude_project_id
            for entry in self._entries.values()
        )

    async def add(
        self,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> _Entry:
        now = datetime.now(UTC)
        entry = _Entry(
            id=f"proj-{len(self._entries) + 1}",
            name=name,
            description=description,
            project_url=project_url,
            github_repo_url=github_repo_url,
            project_path=project_path,
            sandbox_mode=sandbox_mode,
            git_branch=git_branch,
            created_at=now,
            updated_at=now,
        )
        self._entries[entry.id] = entry
        return entry

    async def update(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_url: str | None,
        github_repo_url: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> _Entry | None:
        entry = self._entries.get(project_id)
        if entry is None:
            return None
        now = datetime.now(UTC)
        updated = _Entry(
            id=entry.id,
            name=name,
            description=description,
            project_url=project_url,
            github_repo_url=github_repo_url,
            project_path=project_path,
            sandbox_mode=sandbox_mode,
            git_branch=git_branch,
            created_at=entry.created_at,
            updated_at=now,
        )
        self._entries[project_id] = updated
        return updated

    async def delete(self, project_id: str) -> bool:
        return self._entries.pop(project_id, None) is not None


def test_normalize_project_name_rejects_blank_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_project_name("   ")


def test_normalize_project_name_rejects_too_long_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_project_name("x" * 129)


def test_normalize_project_description_returns_none_for_blank() -> None:
    assert normalize_project_description("   ") is None


def test_normalize_project_description_rejects_too_long_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_project_description("x" * 513)


def test_normalize_project_url_rejects_invalid_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_project_url("invalid url")


def test_normalize_project_url_normalizes_domain_to_https() -> None:
    assert normalize_project_url("marvahome.com") == "https://marvahome.com"


def test_normalize_github_repo_url_accepts_scp_remote() -> None:
    assert normalize_github_repo_url("git@github.com:webu-pro/recodee.git") == "https://github.com/webu-pro/recodee"


def test_normalize_github_repo_url_rejects_non_github_host() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_github_repo_url("https://gitlab.com/webu-pro/recodee")


def test_normalize_project_path_rejects_relative_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_project_path("./repo")


def test_normalize_project_path_accepts_absolute_value() -> None:
    assert normalize_project_path("/home/deadpool/recodee") == "/home/deadpool/recodee"


def test_normalize_project_path_expands_home_shorthand() -> None:
    assert normalize_project_path("~/projects/recodee") == str(Path.home() / "projects" / "recodee")


def test_normalize_project_path_maps_documents_root_shorthand() -> None:
    assert normalize_project_path("/documents/szaloniroda/marva") == str(
        Path.home() / "Documents" / "szaloniroda" / "marva",
    )


def test_normalize_sandbox_mode_defaults_to_workspace_write() -> None:
    assert normalize_sandbox_mode(None) == DEFAULT_SANDBOX_MODE
    assert normalize_sandbox_mode("   ") == DEFAULT_SANDBOX_MODE


def test_normalize_sandbox_mode_rejects_unknown_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_sandbox_mode("unknown")


def test_normalize_git_branch_rejects_invalid_value() -> None:
    with pytest.raises(ProjectValidationError):
        normalize_git_branch("../bad")


@pytest.mark.asyncio
async def test_add_project_rejects_duplicate_name() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    await service.add_project("recodee-core", "Main project", None, None, None, None, None)

    with pytest.raises(ProjectNameExistsError):
        await service.add_project("recodee-core", "Another description", None, None, None, None, None)


@pytest.mark.asyncio
async def test_add_project_rejects_duplicate_path() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    await service.add_project("recodee-core", "Main project", None, None, "/home/deadpool/projects/recodee", None, None)

    with pytest.raises(ProjectPathExistsError):
        await service.add_project(
            "recodee-ui",
            "Another description",
            None,
            None,
            "/home/deadpool/projects/recodee",
            None,
            None,
        )


@pytest.mark.asyncio
async def test_add_project_maps_repository_conflict() -> None:
    class _ConflictRepo(_Repo):
        async def exists_name(self, name: str) -> bool:  # noqa: ARG002
            return False

        async def add(
            self,
            name: str,
            description: str | None,
            project_url: str | None,
            github_repo_url: str | None,
            project_path: str | None,
            sandbox_mode: str,
            git_branch: str | None,
        ) -> _Entry:  # noqa: ARG002
            raise ProjectRepositoryConflictError("name")

    service = ProjectsService(cast(ProjectsRepositoryPort, _ConflictRepo()))

    with pytest.raises(ProjectNameExistsError):
        await service.add_project("recodee-core", "Main project", None, None, None, None, None)


@pytest.mark.asyncio
async def test_update_project_success() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    created = await service.add_project(
        "old-name",
        "Old description",
        "https://old.example.com",
        "https://github.com/example/old-name",
        "/home/deadpool/projects/old-name",
        "workspace-write",
        "feature/old-name",
    )

    updated = await service.update_project(
        created.id,
        "new-name",
        "New description",
        "https://new.example.com",
        "https://github.com/example/new-name",
        "/home/deadpool/projects/new-name",
        "danger-full-access",
        "feature/new-name",
    )

    assert updated is not None
    assert updated.id == created.id
    assert updated.name == "new-name"
    assert updated.description == "New description"
    assert updated.project_url == "https://new.example.com"
    assert updated.github_repo_url == "https://github.com/example/new-name"
    assert updated.project_path == "/home/deadpool/projects/new-name"
    assert updated.sandbox_mode == "danger-full-access"
    assert updated.git_branch == "feature/new-name"


@pytest.mark.asyncio
async def test_update_project_returns_none_when_missing() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))

    updated = await service.update_project("missing", "new-name", None, None, None, None, None, None)

    assert updated is None


@pytest.mark.asyncio
async def test_update_project_maps_repository_conflict() -> None:
    class _ConflictRepo(_Repo):
        async def update(
            self,
            project_id: str,
            name: str,
            description: str | None,
            project_url: str | None,
            github_repo_url: str | None,
            project_path: str | None,
            sandbox_mode: str,
            git_branch: str | None,
        ) -> _Entry | None:  # noqa: ARG002
            raise ProjectRepositoryConflictError("name")

    service = ProjectsService(cast(ProjectsRepositoryPort, _ConflictRepo()))

    with pytest.raises(ProjectNameExistsError):
        await service.update_project("proj-1", "new-name", "new-description", None, None, None, None, None)


@pytest.mark.asyncio
async def test_update_project_rejects_duplicate_path() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    first = await service.add_project("alpha", None, None, None, "/home/deadpool/projects/alpha", None, None)
    await service.add_project("beta", None, None, None, "/home/deadpool/projects/beta", None, None)

    with pytest.raises(ProjectPathExistsError):
        await service.update_project(
            first.id,
            "alpha-renamed",
            None,
            None,
            None,
            "/home/deadpool/projects/beta",
            None,
            None,
        )


@pytest.mark.asyncio
async def test_add_project_applies_planner_defaults() -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))

    created = await service.add_project("planner-defaults", None, None, None, None, None, None)

    assert created.project_url is None
    assert created.github_repo_url is None
    assert created.project_path is None
    assert created.sandbox_mode == DEFAULT_SANDBOX_MODE
    assert created.git_branch is None


@pytest.mark.asyncio
async def test_list_projects_auto_discovers_git_repositories(monkeypatch: pytest.MonkeyPatch) -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    monkeypatch.setenv("CODEX_LB_PROJECTS_AUTO_DISCOVER_ENABLED", "true")

    monkeypatch.setattr(
        "app.modules.projects.service.discover_active_codex_git_projects",
        lambda: [
            AutoDiscoveredGitProject(
                name="recodee",
                project_path="/home/deadpool/Documents/recodee",
                git_branch="dev",
                github_repo_url="https://github.com/webu-pro/recodee",
            )
        ],
    )

    listed = await service.list_projects()
    assert len(listed.entries) == 1
    assert listed.entries[0].name == "recodee"
    assert listed.entries[0].project_path == "/home/deadpool/Documents/recodee"
    assert listed.entries[0].git_branch == "dev"
    assert listed.entries[0].github_repo_url == "https://github.com/webu-pro/recodee"


@pytest.mark.asyncio
async def test_list_projects_auto_discovery_updates_existing_missing_git_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    service = ProjectsService(cast(ProjectsRepositoryPort, _Repo()))
    monkeypatch.setenv("CODEX_LB_PROJECTS_AUTO_DISCOVER_ENABLED", "true")
    created = await service.add_project(
        "recodee",
        None,
        "https://recodee.com",
        None,
        "/home/deadpool/Documents/recodee",
        None,
        None,
    )

    monkeypatch.setattr(
        "app.modules.projects.service.discover_active_codex_git_projects",
        lambda: [
            AutoDiscoveredGitProject(
                name="recodee",
                project_path="/home/deadpool/Documents/recodee",
                git_branch="feature/active",
                github_repo_url="https://github.com/webu-pro/recodee",
            )
        ],
    )

    listed = await service.list_projects()
    assert len(listed.entries) == 1
    assert listed.entries[0].id == created.id
    assert listed.entries[0].project_url == "https://recodee.com"
    assert listed.entries[0].git_branch == "feature/active"
    assert listed.entries[0].github_repo_url == "https://github.com/webu-pro/recodee"


def test_discover_active_codex_git_projects_includes_current_process_cwd_repo(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    repo_root = tmp_path / "recodee"
    repo_root.mkdir()
    daemon_cwd = repo_root / "app"
    daemon_cwd.mkdir()

    monkeypatch.setattr(
        "app.modules.projects.service._iter_codex_process_cwds",
        lambda: [],
    )
    monkeypatch.setattr(
        "app.modules.projects.service._resolve_current_process_cwd",
        lambda: daemon_cwd,
    )
    monkeypatch.setattr(
        "app.modules.projects.service._resolve_git_repo_root",
        lambda cwd: repo_root if cwd == daemon_cwd else None,
    )
    monkeypatch.setattr(
        "app.modules.projects.service._resolve_git_branch",
        lambda _repo_root: "dev",
    )
    monkeypatch.setattr(
        "app.modules.projects.service._resolve_github_repo_url",
        lambda _repo_root: "https://github.com/webu-pro/recodee",
    )

    discovered = discover_active_codex_git_projects()
    assert len(discovered) == 1
    assert discovered[0].name == "recodee"
    assert discovered[0].project_path == str(repo_root)
    assert discovered[0].git_branch == "dev"
    assert discovered[0].github_repo_url == "https://github.com/webu-pro/recodee"
