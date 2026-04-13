from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from app.modules.agents.repository import AgentRepositoryConflictError


class AgentEntryLike(Protocol):
    id: str
    name: str
    status: str
    description: str | None
    visibility: str
    runtime: str
    instructions: str
    max_concurrent_tasks: int
    avatar_data_url: str | None
    created_at: datetime
    updated_at: datetime


class AgentsRepositoryPort(Protocol):
    async def list_entries(self) -> Sequence[AgentEntryLike]: ...

    async def exists_name(self, name: str) -> bool: ...

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
    ) -> AgentEntryLike: ...

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
    ) -> AgentEntryLike | None: ...

    async def delete(self, agent_id: str) -> bool: ...


class AgentValidationError(ValueError):
    def __init__(
        self,
        message: str,
        *,
        code: Literal[
            "invalid_agent_name",
            "invalid_agent_status",
            "invalid_agent_description",
            "invalid_agent_visibility",
            "invalid_agent_runtime",
            "invalid_agent_instructions",
            "invalid_agent_max_concurrent_tasks",
            "invalid_agent_avatar",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


class AgentNameExistsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AgentEntryData:
    id: str
    name: str
    status: Literal["idle", "active"]
    description: str | None
    visibility: Literal["workspace", "private"]
    runtime: str
    instructions: str
    max_concurrent_tasks: int
    avatar_data_url: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class AgentsListData:
    entries: list[AgentEntryData]


DEFAULT_RUNTIME = "Codex (recodee)"
DEFAULT_STATUS = "idle"
DEFAULT_VISIBILITY = "workspace"
DEFAULT_MAX_CONCURRENT_TASKS = 6
MAX_MAX_CONCURRENT_TASKS = 50
MAX_AVATAR_BYTES = 1_000_000
MAX_RUNTIME_LENGTH = 255
MAX_INSTRUCTIONS_LENGTH = 50_000
MAX_NAME_LENGTH = 128
MAX_DESCRIPTION_LENGTH = 512
_AVATAR_DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\\s]+)$",
    re.IGNORECASE,
)


class AgentsService:
    def __init__(self, repository: AgentsRepositoryPort) -> None:
        self._repository = repository

    async def list_agents(self) -> AgentsListData:
        rows = list(await self._repository.list_entries())
        if len(rows) == 0:
            await self._create_default_master_agent()
            rows = list(await self._repository.list_entries())

        entries = [_to_entry_data(row) for row in rows]
        return AgentsListData(entries=entries)

    async def add_agent(
        self,
        *,
        name: str,
        description: str | None,
        visibility: str | None,
        runtime: str | None,
        instructions: str | None,
        max_concurrent_tasks: int | None,
        avatar_data_url: str | None,
    ) -> AgentEntryData:
        normalized_name = normalize_agent_name(name)
        normalized_description = normalize_agent_description(description)
        normalized_visibility = normalize_agent_visibility(visibility)
        normalized_runtime = normalize_agent_runtime(runtime)
        normalized_instructions = normalize_agent_instructions(instructions)
        normalized_max_concurrent_tasks = normalize_agent_max_concurrent_tasks(max_concurrent_tasks)
        normalized_avatar_data_url = normalize_agent_avatar_data_url(avatar_data_url)

        if await self._repository.exists_name(normalized_name):
            raise AgentNameExistsError("Agent name already exists")

        try:
            row = await self._repository.add(
                name=normalized_name,
                status=DEFAULT_STATUS,
                description=normalized_description,
                visibility=normalized_visibility,
                runtime=normalized_runtime,
                instructions=normalized_instructions,
                max_concurrent_tasks=normalized_max_concurrent_tasks,
                avatar_data_url=normalized_avatar_data_url,
            )
        except AgentRepositoryConflictError as exc:
            if exc.field == "name":
                raise AgentNameExistsError("Agent name already exists") from exc
            raise

        return _to_entry_data(row)

    async def update_agent(
        self,
        *,
        agent_id: str,
        name: str,
        status: str | None,
        description: str | None,
        visibility: str | None,
        runtime: str | None,
        instructions: str | None,
        max_concurrent_tasks: int | None,
        avatar_data_url: str | None,
    ) -> AgentEntryData | None:
        normalized_name = normalize_agent_name(name)
        normalized_status = normalize_agent_status(status)
        normalized_description = normalize_agent_description(description)
        normalized_visibility = normalize_agent_visibility(visibility)
        normalized_runtime = normalize_agent_runtime(runtime)
        normalized_instructions = normalize_agent_instructions(instructions)
        normalized_max_concurrent_tasks = normalize_agent_max_concurrent_tasks(max_concurrent_tasks)
        normalized_avatar_data_url = normalize_agent_avatar_data_url(avatar_data_url)

        try:
            row = await self._repository.update(
                agent_id=agent_id,
                name=normalized_name,
                status=normalized_status,
                description=normalized_description,
                visibility=normalized_visibility,
                runtime=normalized_runtime,
                instructions=normalized_instructions,
                max_concurrent_tasks=normalized_max_concurrent_tasks,
                avatar_data_url=normalized_avatar_data_url,
            )
        except AgentRepositoryConflictError as exc:
            if exc.field == "name":
                raise AgentNameExistsError("Agent name already exists") from exc
            raise

        if row is None:
            return None

        return _to_entry_data(row)

    async def remove_agent(self, agent_id: str) -> bool:
        return await self._repository.delete(agent_id)

    async def _create_default_master_agent(self) -> None:
        try:
            await self._repository.add(
                name="Master Agent",
                status=DEFAULT_STATUS,
                description="",
                visibility=DEFAULT_VISIBILITY,
                runtime=DEFAULT_RUNTIME,
                instructions="",
                max_concurrent_tasks=DEFAULT_MAX_CONCURRENT_TASKS,
                avatar_data_url=None,
            )
        except AgentRepositoryConflictError:
            # Another process inserted the bootstrap row concurrently.
            pass


def _to_entry_data(row: AgentEntryLike) -> AgentEntryData:
    status: Literal["idle", "active"] = "active" if row.status == "active" else "idle"
    visibility: Literal["workspace", "private"] = "private" if row.visibility == "private" else "workspace"
    return AgentEntryData(
        id=row.id,
        name=row.name,
        status=status,
        description=row.description,
        visibility=visibility,
        runtime=row.runtime,
        instructions=row.instructions,
        max_concurrent_tasks=row.max_concurrent_tasks,
        avatar_data_url=row.avatar_data_url,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def normalize_agent_name(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise AgentValidationError("Agent name is required", code="invalid_agent_name")
    if len(normalized) > MAX_NAME_LENGTH:
        raise AgentValidationError(
            f"Agent name must be {MAX_NAME_LENGTH} characters or fewer",
            code="invalid_agent_name",
        )
    return normalized


def normalize_agent_status(value: str | None) -> Literal["idle", "active"]:
    if value is None:
        return DEFAULT_STATUS
    normalized = value.strip().lower()
    if not normalized:
        return DEFAULT_STATUS
    if normalized not in {"idle", "active"}:
        raise AgentValidationError(
            "Agent status must be idle or active",
            code="invalid_agent_status",
        )
    return normalized  # type: ignore[return-value]


def normalize_agent_description(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if len(normalized) > MAX_DESCRIPTION_LENGTH:
        raise AgentValidationError(
            f"Agent description must be {MAX_DESCRIPTION_LENGTH} characters or fewer",
            code="invalid_agent_description",
        )
    return normalized


def normalize_agent_visibility(value: str | None) -> Literal["workspace", "private"]:
    if value is None:
        return DEFAULT_VISIBILITY
    normalized = value.strip().lower()
    if not normalized:
        return DEFAULT_VISIBILITY
    if normalized not in {"workspace", "private"}:
        raise AgentValidationError(
            "Agent visibility must be workspace or private",
            code="invalid_agent_visibility",
        )
    return normalized  # type: ignore[return-value]


def normalize_agent_runtime(value: str | None) -> str:
    if value is None:
        return DEFAULT_RUNTIME
    normalized = value.strip()
    if not normalized:
        return DEFAULT_RUNTIME
    if len(normalized) > MAX_RUNTIME_LENGTH:
        raise AgentValidationError(
            f"Agent runtime must be {MAX_RUNTIME_LENGTH} characters or fewer",
            code="invalid_agent_runtime",
        )
    return normalized


def normalize_agent_instructions(value: str | None) -> str:
    if value is None:
        return ""
    normalized = value.strip()
    if len(normalized) > MAX_INSTRUCTIONS_LENGTH:
        raise AgentValidationError(
            f"Agent instructions must be {MAX_INSTRUCTIONS_LENGTH} characters or fewer",
            code="invalid_agent_instructions",
        )
    return normalized


def normalize_agent_max_concurrent_tasks(value: int | None) -> int:
    if value is None:
        return DEFAULT_MAX_CONCURRENT_TASKS
    if value < 1 or value > MAX_MAX_CONCURRENT_TASKS:
        raise AgentValidationError(
            f"Max concurrent tasks must be between 1 and {MAX_MAX_CONCURRENT_TASKS}",
            code="invalid_agent_max_concurrent_tasks",
        )
    return value


def normalize_agent_avatar_data_url(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    if not normalized:
        return None

    match = _AVATAR_DATA_URL_RE.match(normalized)
    if match is None:
        raise AgentValidationError(
            "Agent avatar must be a valid base64-encoded image data URL",
            code="invalid_agent_avatar",
        )

    media_type = match.group(1).lower()
    if media_type == "image/jpg":
        media_type = "image/jpeg"

    encoded_payload = re.sub(r"\s+", "", match.group(2))
    try:
        raw = base64.b64decode(encoded_payload, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise AgentValidationError(
            "Agent avatar must be a valid base64-encoded image data URL",
            code="invalid_agent_avatar",
        ) from exc

    if len(raw) == 0:
        raise AgentValidationError(
            "Agent avatar image is empty",
            code="invalid_agent_avatar",
        )

    if len(raw) > MAX_AVATAR_BYTES:
        raise AgentValidationError(
            "Agent avatar image must be 1MB or smaller",
            code="invalid_agent_avatar",
        )

    canonical_payload = base64.b64encode(raw).decode("ascii")
    return f"data:{media_type};base64,{canonical_payload}"
