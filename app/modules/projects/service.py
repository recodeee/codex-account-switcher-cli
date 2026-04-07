from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.modules.projects.repository import ProjectRepositoryConflictError


class ProjectEntryLike(Protocol):
    id: str
    name: str
    description: str | None
    project_path: str | None
    sandbox_mode: str
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


class ProjectsRepositoryPort(Protocol):
    async def list_entries(self) -> Sequence[ProjectEntryLike]: ...

    async def exists_name(self, name: str) -> bool: ...

    async def add(
        self,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> ProjectEntryLike: ...

    async def update(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> ProjectEntryLike | None: ...

    async def delete(self, project_id: str) -> bool: ...


class ProjectValidationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "invalid_project_name",
            "invalid_project_description",
            "invalid_project_path",
            "invalid_project_sandbox",
            "invalid_project_branch",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


class ProjectNameExistsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProjectEntryData:
    id: str
    name: str
    description: str | None
    project_path: str | None
    sandbox_mode: str
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ProjectsListData:
    entries: list[ProjectEntryData]


DEFAULT_SANDBOX_MODE = "workspace-write"
ALLOWED_SANDBOX_MODES = ("read-only", "workspace-write", "danger-full-access")
_WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN = re.compile(r"^[A-Za-z]:[\\/]")
_GIT_BRANCH_PATTERN = re.compile(r"^[A-Za-z0-9._/-]+$")


class ProjectsService:
    def __init__(self, repository: ProjectsRepositoryPort) -> None:
        self._repository = repository

    async def list_projects(self) -> ProjectsListData:
        rows = await self._repository.list_entries()
        entries = [
            ProjectEntryData(
                id=row.id,
                name=row.name,
                description=row.description,
                project_path=row.project_path,
                sandbox_mode=row.sandbox_mode,
                git_branch=row.git_branch,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
        return ProjectsListData(entries=entries)

    async def add_project(
        self,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str | None,
        git_branch: str | None,
    ) -> ProjectEntryData:
        normalized_name = normalize_project_name(name)
        normalized_description = normalize_project_description(description)
        normalized_project_path = normalize_project_path(project_path)
        normalized_sandbox_mode = normalize_sandbox_mode(sandbox_mode)
        normalized_git_branch = normalize_git_branch(git_branch)

        if await self._repository.exists_name(normalized_name):
            raise ProjectNameExistsError("Project name already exists")

        try:
            row = await self._repository.add(
                normalized_name,
                normalized_description,
                normalized_project_path,
                normalized_sandbox_mode,
                normalized_git_branch,
            )
        except ProjectRepositoryConflictError as exc:
            if exc.field == "name":
                raise ProjectNameExistsError("Project name already exists") from exc
            raise

        return ProjectEntryData(
            id=row.id,
            name=row.name,
            description=row.description,
            project_path=row.project_path,
            sandbox_mode=row.sandbox_mode,
            git_branch=row.git_branch,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def update_project(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str | None,
        git_branch: str | None,
    ) -> ProjectEntryData | None:
        normalized_name = normalize_project_name(name)
        normalized_description = normalize_project_description(description)
        normalized_project_path = normalize_project_path(project_path)
        normalized_sandbox_mode = normalize_sandbox_mode(sandbox_mode)
        normalized_git_branch = normalize_git_branch(git_branch)

        try:
            row = await self._repository.update(
                project_id,
                normalized_name,
                normalized_description,
                normalized_project_path,
                normalized_sandbox_mode,
                normalized_git_branch,
            )
        except ProjectRepositoryConflictError as exc:
            if exc.field == "name":
                raise ProjectNameExistsError("Project name already exists") from exc
            raise

        if row is None:
            return None

        return ProjectEntryData(
            id=row.id,
            name=row.name,
            description=row.description,
            project_path=row.project_path,
            sandbox_mode=row.sandbox_mode,
            git_branch=row.git_branch,
            created_at=row.created_at,
            updated_at=row.updated_at,
        )

    async def remove_project(self, project_id: str) -> bool:
        return await self._repository.delete(project_id)


def normalize_project_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ProjectValidationError("Project name is required", code="invalid_project_name")
    if len(normalized) > 128:
        raise ProjectValidationError("Project name must be 128 characters or fewer", code="invalid_project_name")
    return normalized


def normalize_project_description(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 512:
        raise ProjectValidationError(
            "Project description must be 512 characters or fewer",
            code="invalid_project_description",
        )
    return normalized


def normalize_project_path(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 1024:
        raise ProjectValidationError(
            "Project path must be 1024 characters or fewer",
            code="invalid_project_path",
        )
    if not _is_absolute_project_path(normalized):
        raise ProjectValidationError(
            "Project path must be absolute",
            code="invalid_project_path",
        )
    return normalized


def normalize_sandbox_mode(value: str | None) -> str:
    if value is None:
        return DEFAULT_SANDBOX_MODE
    normalized = value.strip().lower()
    if not normalized:
        return DEFAULT_SANDBOX_MODE
    if normalized not in ALLOWED_SANDBOX_MODES:
        raise ProjectValidationError(
            "Sandbox mode must be one of: read-only, workspace-write, danger-full-access",
            code="invalid_project_sandbox",
        )
    return normalized


def normalize_git_branch(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > 255:
        raise ProjectValidationError(
            "Git branch must be 255 characters or fewer",
            code="invalid_project_branch",
        )
    if (
        not _GIT_BRANCH_PATTERN.fullmatch(normalized)
        or normalized.startswith("/")
        or normalized.endswith("/")
        or ".." in normalized
        or normalized.endswith(".lock")
    ):
        raise ProjectValidationError(
            "Git branch contains invalid characters",
            code="invalid_project_branch",
        )
    return normalized


def _is_absolute_project_path(value: str) -> bool:
    return value.startswith("/") or value.startswith("\\\\") or _WINDOWS_DRIVE_ABSOLUTE_PATH_PATTERN.match(value) is not None
