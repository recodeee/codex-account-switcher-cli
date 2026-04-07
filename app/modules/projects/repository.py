from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Project


class ProjectRepositoryConflictError(ValueError):
    def __init__(self, field: Literal["name", "unknown"] = "unknown") -> None:
        self.field = field
        super().__init__("Project already exists")


class ProjectsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_entries(self) -> Sequence[Project]:
        result = await self._session.execute(select(Project).order_by(Project.created_at, Project.name))
        return list(result.scalars().all())

    async def exists_name(self, name: str) -> bool:
        result = await self._session.execute(select(Project.id).where(Project.name == name).limit(1))
        return result.scalar_one_or_none() is not None

    async def add(
        self,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> Project:
        row = Project(
            name=name,
            description=description,
            project_path=project_path,
            sandbox_mode=sandbox_mode,
            git_branch=git_branch,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ProjectRepositoryConflictError(_detect_conflict_field(exc)) from exc
        await self._session.refresh(row)
        return row

    async def update(
        self,
        project_id: str,
        name: str,
        description: str | None,
        project_path: str | None,
        sandbox_mode: str,
        git_branch: str | None,
    ) -> Project | None:
        row = await self._session.get(Project, project_id)
        if row is None:
            return None
        row.name = name
        row.description = description
        row.project_path = project_path
        row.sandbox_mode = sandbox_mode
        row.git_branch = git_branch
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise ProjectRepositoryConflictError(_detect_conflict_field(exc)) from exc
        await self._session.refresh(row)
        return row

    async def delete(self, project_id: str) -> bool:
        row = await self._session.get(Project, project_id)
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True


def _detect_conflict_field(exc: IntegrityError) -> Literal["name", "unknown"]:
    message = str(getattr(exc, "orig", exc)).lower()
    if "projects.name" in message or "(name)" in message:
        return "name"
    return "unknown"
