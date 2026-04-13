from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.modules.workspaces.repository import WorkspaceRepositoryConflictError

DEFAULT_WORKSPACE_NAME = "recodee.com"
DEFAULT_WORKSPACE_LABEL = "Team"
_SLUG_PATTERN = re.compile(r"[^a-z0-9]+")


class WorkspaceEntryLike(Protocol):
    id: str
    name: str
    slug: str
    label: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WorkspacesRepositoryPort(Protocol):
    async def list_entries(self) -> Sequence[WorkspaceEntryLike]: ...

    async def exists_name(self, name: str) -> bool: ...

    async def exists_slug(self, slug: str) -> bool: ...

    async def add(self, *, name: str, slug: str, label: str, is_active: bool) -> WorkspaceEntryLike: ...

    async def set_active(self, workspace_id: str) -> WorkspaceEntryLike | None: ...


class WorkspaceValidationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal["invalid_workspace_name", "invalid_workspace_label"],
    ) -> None:
        self.code = code
        super().__init__(message)


class WorkspaceNameExistsError(ValueError):
    pass


class WorkspaceNotFoundError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class WorkspaceEntryData:
    id: str
    name: str
    slug: str
    label: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class WorkspacesListData:
    entries: list[WorkspaceEntryData]


class WorkspacesService:
    def __init__(self, repository: WorkspacesRepositoryPort) -> None:
        self._repository = repository

    async def list_workspaces(self) -> WorkspacesListData:
        rows = list(await self._repository.list_entries())
        if not rows:
            seeded = await self._repository.add(
                name=DEFAULT_WORKSPACE_NAME,
                slug=slugify_workspace_name(DEFAULT_WORKSPACE_NAME),
                label=DEFAULT_WORKSPACE_LABEL,
                is_active=True,
            )
            rows = [seeded]
        elif not any(row.is_active for row in rows):
            selected = await self._repository.set_active(rows[0].id)
            if selected is not None:
                rows = [selected, *[row for row in rows[1:] if row.id != selected.id]]
        return WorkspacesListData(entries=[_to_entry_data(row) for row in rows])

    async def create_workspace(self, *, name: str, label: str | None = None) -> WorkspaceEntryData:
        normalized_name = normalize_workspace_name(name)
        normalized_label = normalize_workspace_label(label)

        if await self._repository.exists_name(normalized_name):
            raise WorkspaceNameExistsError("Workspace name already exists")

        slug = await self._resolve_unique_slug(normalized_name)

        try:
            created = await self._repository.add(
                name=normalized_name,
                slug=slug,
                label=normalized_label,
                is_active=False,
            )
        except WorkspaceRepositoryConflictError as exc:
            if exc.field == "name":
                raise WorkspaceNameExistsError("Workspace name already exists") from exc
            raise

        selected = await self._repository.set_active(created.id)
        if selected is None:
            raise WorkspaceNotFoundError("Workspace not found")
        return _to_entry_data(selected)

    async def select_workspace(self, workspace_id: str) -> WorkspaceEntryData:
        selected = await self._repository.set_active(workspace_id)
        if selected is None:
            raise WorkspaceNotFoundError("Workspace not found")
        return _to_entry_data(selected)

    async def _resolve_unique_slug(self, name: str) -> str:
        base = slugify_workspace_name(name)
        candidate = base
        attempt = 1
        while await self._repository.exists_slug(candidate):
            attempt += 1
            suffix = f"-{attempt}"
            max_base_length = max(1, 160 - len(suffix))
            candidate = f"{base[:max_base_length]}{suffix}"
        return candidate


def normalize_workspace_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise WorkspaceValidationError("Workspace name is required", code="invalid_workspace_name")
    if len(normalized) > 128:
        raise WorkspaceValidationError(
            "Workspace name must be 128 characters or fewer",
            code="invalid_workspace_name",
        )
    return normalized


def normalize_workspace_label(value: str | None) -> str:
    if value is None:
        return DEFAULT_WORKSPACE_LABEL
    normalized = value.strip()
    if not normalized:
        return DEFAULT_WORKSPACE_LABEL
    if len(normalized) > 64:
        raise WorkspaceValidationError(
            "Workspace label must be 64 characters or fewer",
            code="invalid_workspace_label",
        )
    return normalized


def slugify_workspace_name(name: str) -> str:
    normalized = _SLUG_PATTERN.sub("-", name.lower()).strip("-")
    return normalized or "workspace"


def _to_entry_data(row: WorkspaceEntryLike) -> WorkspaceEntryData:
    return WorkspaceEntryData(
        id=row.id,
        name=row.name,
        slug=row.slug,
        label=row.label,
        is_active=row.is_active,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )
