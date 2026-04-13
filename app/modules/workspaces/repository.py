from __future__ import annotations

from collections.abc import Sequence
from typing import Literal

from sqlalchemy import case, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SwitchboardWorkspace


class WorkspaceRepositoryConflictError(ValueError):
    def __init__(self, field: Literal["name", "slug", "unknown"] = "unknown") -> None:
        self.field = field
        super().__init__("Workspace already exists")


class WorkspacesRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_entries(self) -> Sequence[SwitchboardWorkspace]:
        await self._ensure_workspaces_table()
        result = await self._session.execute(
            select(SwitchboardWorkspace).order_by(
                case((SwitchboardWorkspace.is_active, 0), else_=1),
                SwitchboardWorkspace.created_at,
                SwitchboardWorkspace.name,
            )
        )
        return list(result.scalars().all())

    async def exists_name(self, name: str) -> bool:
        await self._ensure_workspaces_table()
        result = await self._session.execute(
            select(SwitchboardWorkspace.id).where(SwitchboardWorkspace.name == name).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def exists_slug(self, slug: str) -> bool:
        await self._ensure_workspaces_table()
        result = await self._session.execute(
            select(SwitchboardWorkspace.id).where(SwitchboardWorkspace.slug == slug).limit(1)
        )
        return result.scalar_one_or_none() is not None

    async def add(self, *, name: str, slug: str, label: str, is_active: bool) -> SwitchboardWorkspace:
        await self._ensure_workspaces_table()
        row = SwitchboardWorkspace(
            name=name,
            slug=slug,
            label=label,
            is_active=is_active,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise WorkspaceRepositoryConflictError(_detect_conflict_field(exc)) from exc
        await self._session.refresh(row)
        return row

    async def set_active(self, workspace_id: str) -> SwitchboardWorkspace | None:
        await self._ensure_workspaces_table()
        row = await self._session.get(SwitchboardWorkspace, workspace_id)
        if row is None:
            return None
        await self._session.execute(update(SwitchboardWorkspace).values(is_active=False))
        row.is_active = True
        await self._session.commit()
        await self._session.refresh(row)
        return row

    async def _ensure_workspaces_table(self) -> None:
        try:
            await self._session.execute(select(SwitchboardWorkspace.id).limit(1))
            return
        except OperationalError as exc:
            if not _is_missing_workspaces_table_error(exc):
                raise
            await self._session.rollback()

        await self._session.run_sync(
            lambda sync_session: SwitchboardWorkspace.__table__.create(bind=sync_session.get_bind(), checkfirst=True)
        )
        await self._session.commit()


def _detect_conflict_field(exc: IntegrityError) -> Literal["name", "slug", "unknown"]:
    message = str(getattr(exc, "orig", exc)).lower()
    if "switchboard_workspaces.name" in message or "(name)" in message:
        return "name"
    if "switchboard_workspaces.slug" in message or "(slug)" in message:
        return "slug"
    return "unknown"


def _is_missing_workspaces_table_error(exc: OperationalError) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return (
        "no such table: switchboard_workspaces" in message
        or ('relation "switchboard_workspaces" does not exist' in message)
        or ("relation 'switchboard_workspaces' does not exist" in message)
    )

