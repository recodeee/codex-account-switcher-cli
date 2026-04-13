from __future__ import annotations

from collections.abc import Sequence
from typing import cast
from typing import Literal

from sqlalchemy import Table, select
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import SwitchboardAgent


class AgentRepositoryConflictError(ValueError):
    def __init__(self, field: Literal["name", "unknown"] = "unknown") -> None:
        self.field = field
        super().__init__("Agent already exists")


class AgentsRepository:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_entries(self) -> Sequence[SwitchboardAgent]:
        await self._ensure_agents_table()
        result = await self._session.execute(select(SwitchboardAgent).order_by(SwitchboardAgent.created_at, SwitchboardAgent.name))
        return list(result.scalars().all())

    async def exists_name(self, name: str) -> bool:
        result = await self._session.execute(select(SwitchboardAgent.id).where(SwitchboardAgent.name == name).limit(1))
        return result.scalar_one_or_none() is not None

    async def add(
        self,
        *,
        name: str,
        status: str,
        description: str | None,
        visibility: str,
        runtime: str,
        instructions: str,
        max_concurrent_tasks: int,
        avatar_data_url: str | None,
    ) -> SwitchboardAgent:
        await self._ensure_agents_table()
        row = SwitchboardAgent(
            name=name,
            status=status,
            description=description,
            visibility=visibility,
            runtime=runtime,
            instructions=instructions,
            max_concurrent_tasks=max_concurrent_tasks,
            avatar_data_url=avatar_data_url,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise AgentRepositoryConflictError(_detect_conflict_field(exc)) from exc
        await self._session.refresh(row)
        return row

    async def update(
        self,
        *,
        agent_id: str,
        name: str,
        status: str,
        description: str | None,
        visibility: str,
        runtime: str,
        instructions: str,
        max_concurrent_tasks: int,
        avatar_data_url: str | None,
    ) -> SwitchboardAgent | None:
        await self._ensure_agents_table()
        row = await self._session.get(SwitchboardAgent, agent_id)
        if row is None:
            return None

        row.name = name
        row.status = status
        row.description = description
        row.visibility = visibility
        row.runtime = runtime
        row.instructions = instructions
        row.max_concurrent_tasks = max_concurrent_tasks
        row.avatar_data_url = avatar_data_url

        try:
            await self._session.commit()
        except IntegrityError as exc:
            await self._session.rollback()
            raise AgentRepositoryConflictError(_detect_conflict_field(exc)) from exc
        await self._session.refresh(row)
        return row

    async def delete(self, agent_id: str) -> bool:
        await self._ensure_agents_table()
        row = await self._session.get(SwitchboardAgent, agent_id)
        if row is None:
            return False
        await self._session.delete(row)
        await self._session.commit()
        return True

    async def _ensure_agents_table(self) -> None:
        try:
            await self._session.execute(select(SwitchboardAgent.id).limit(1))
            return
        except OperationalError as exc:
            if not _is_missing_agents_table_error(exc):
                raise
            await self._session.rollback()

        await self._session.run_sync(
            lambda sync_session: SwitchboardAgent.metadata.create_all(
                bind=sync_session.get_bind(),
                tables=[cast(Table, SwitchboardAgent.__table__)],
                checkfirst=True,
            )
        )
        await self._session.commit()


def _detect_conflict_field(exc: IntegrityError) -> Literal["name", "unknown"]:
    message = str(getattr(exc, "orig", exc)).lower()
    if "switchboard_agents.name" in message or "uq_switchboard_agents_name" in message or "(name)" in message:
        return "name"
    return "unknown"


def _is_missing_agents_table_error(exc: OperationalError) -> bool:
    message = str(getattr(exc, "orig", exc)).lower()
    return (
        "no such table: switchboard_agents" in message
        or ('relation "switchboard_agents" does not exist' in message)
        or ("relation 'switchboard_agents' does not exist" in message)
    )
