from __future__ import annotations

import base64
import binascii
import json
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
    environment_variables_json: str | None
    created_at: datetime
    updated_at: datetime


class AgentEnvironmentVariableLike(Protocol):
    key: str
    value: str


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
        environment_variables_json: str,
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
        environment_variables_json: str,
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
            "invalid_agent_environment_variables",
        ],
    ) -> None:
        self.code = code
        super().__init__(message)


class AgentNameExistsError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class AgentEnvironmentVariableData:
    key: str
    value: str


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
    environment_variables: list[AgentEnvironmentVariableData]
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
MAX_ENVIRONMENT_VARIABLE_COUNT = 64
MAX_ENVIRONMENT_VARIABLE_KEY_LENGTH = 128
MAX_ENVIRONMENT_VARIABLE_VALUE_LENGTH = 4_000
DEFAULT_AGENT_NAMES = (
    "Master Agent",
    "Cleanup Agent",
)
_AVATAR_DATA_URL_RE = re.compile(
    r"^data:(image/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=\\s]+)$",
    re.IGNORECASE,
)
_ENVIRONMENT_VARIABLE_KEY_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class AgentsService:
    def __init__(self, repository: AgentsRepositoryPort) -> None:
        self._repository = repository

    async def list_agents(self) -> AgentsListData:
        rows = list(await self._repository.list_entries())
        if len(rows) == 0 or self._has_missing_default_agents(rows):
            await self._create_missing_default_agents(rows)
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
        environment_variables: Sequence[AgentEnvironmentVariableLike] | None,
    ) -> AgentEntryData:
        normalized_name = normalize_agent_name(name)
        normalized_description = normalize_agent_description(description)
        normalized_visibility = normalize_agent_visibility(visibility)
        normalized_runtime = normalize_agent_runtime(runtime)
        normalized_instructions = normalize_agent_instructions(instructions)
        normalized_max_concurrent_tasks = normalize_agent_max_concurrent_tasks(max_concurrent_tasks)
        normalized_avatar_data_url = normalize_agent_avatar_data_url(avatar_data_url)
        normalized_environment_variables = normalize_agent_environment_variables(environment_variables)
        serialized_environment_variables = serialize_agent_environment_variables(normalized_environment_variables)

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
                environment_variables_json=serialized_environment_variables,
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
        environment_variables: Sequence[AgentEnvironmentVariableLike] | None,
    ) -> AgentEntryData | None:
        normalized_name = normalize_agent_name(name)
        normalized_status = normalize_agent_status(status)
        normalized_description = normalize_agent_description(description)
        normalized_visibility = normalize_agent_visibility(visibility)
        normalized_runtime = normalize_agent_runtime(runtime)
        normalized_instructions = normalize_agent_instructions(instructions)
        normalized_max_concurrent_tasks = normalize_agent_max_concurrent_tasks(max_concurrent_tasks)
        normalized_avatar_data_url = normalize_agent_avatar_data_url(avatar_data_url)
        normalized_environment_variables = normalize_agent_environment_variables(environment_variables)
        serialized_environment_variables = serialize_agent_environment_variables(normalized_environment_variables)

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
                environment_variables_json=serialized_environment_variables,
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

    async def _create_missing_default_agents(self, rows: Sequence[AgentEntryLike]) -> None:
        existing_names = {row.name for row in rows}
        for default_name in DEFAULT_AGENT_NAMES:
            if default_name in existing_names:
                continue
            try:
                await self._repository.add(
                    name=default_name,
                    status=DEFAULT_STATUS,
                    description="",
                    visibility=DEFAULT_VISIBILITY,
                    runtime=DEFAULT_RUNTIME,
                    instructions="",
                    max_concurrent_tasks=DEFAULT_MAX_CONCURRENT_TASKS,
                    avatar_data_url=None,
                    environment_variables_json=serialize_agent_environment_variables([]),
                )
            except AgentRepositoryConflictError:
                # Another process inserted the bootstrap row concurrently.
                continue

    def _has_missing_default_agents(self, rows: Sequence[AgentEntryLike]) -> bool:
        existing_names = {row.name for row in rows}
        for default_name in DEFAULT_AGENT_NAMES:
            if default_name not in existing_names:
                return True
        return False


def _to_entry_data(row: AgentEntryLike) -> AgentEntryData:
    status: Literal["idle", "active"] = "active" if row.status == "active" else "idle"
    visibility: Literal["workspace", "private"] = "private" if row.visibility == "private" else "workspace"
    environment_variables = deserialize_agent_environment_variables(row.environment_variables_json)
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
        environment_variables=environment_variables,
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


def normalize_agent_environment_variables(
    value: Sequence[AgentEnvironmentVariableLike] | None,
) -> list[AgentEnvironmentVariableData]:
    if value is None:
        return []
    if len(value) > MAX_ENVIRONMENT_VARIABLE_COUNT:
        raise AgentValidationError(
            f"Agent environment variables must be {MAX_ENVIRONMENT_VARIABLE_COUNT} entries or fewer",
            code="invalid_agent_environment_variables",
        )

    normalized: list[AgentEnvironmentVariableData] = []
    seen_keys: set[str] = set()
    for entry in value:
        key = entry.key.strip()
        env_value = entry.value

        if not key:
            raise AgentValidationError(
                "Environment variable key is required",
                code="invalid_agent_environment_variables",
            )
        if len(key) > MAX_ENVIRONMENT_VARIABLE_KEY_LENGTH:
            raise AgentValidationError(
                f"Environment variable key must be {MAX_ENVIRONMENT_VARIABLE_KEY_LENGTH} characters or fewer",
                code="invalid_agent_environment_variables",
            )
        if not _ENVIRONMENT_VARIABLE_KEY_RE.match(key):
            raise AgentValidationError(
                "Environment variable key must start with a letter/underscore and use only letters, numbers, and underscores",
                code="invalid_agent_environment_variables",
            )
        if len(env_value) > MAX_ENVIRONMENT_VARIABLE_VALUE_LENGTH:
            raise AgentValidationError(
                f"Environment variable value must be {MAX_ENVIRONMENT_VARIABLE_VALUE_LENGTH} characters or fewer",
                code="invalid_agent_environment_variables",
            )
        if key in seen_keys:
            raise AgentValidationError(
                f"Duplicate environment variable key: {key}",
                code="invalid_agent_environment_variables",
            )

        seen_keys.add(key)
        normalized.append(AgentEnvironmentVariableData(key=key, value=env_value))

    return normalized


def serialize_agent_environment_variables(value: Sequence[AgentEnvironmentVariableData]) -> str:
    payload = [{"key": entry.key, "value": entry.value} for entry in value]
    return json.dumps(payload, ensure_ascii=True, separators=(",", ":"))


def deserialize_agent_environment_variables(raw: str | None) -> list[AgentEnvironmentVariableData]:
    if raw is None:
        return []
    serialized = raw.strip()
    if not serialized:
        return []
    try:
        parsed = json.loads(serialized)
    except json.JSONDecodeError:
        return []
    if not isinstance(parsed, list):
        return []

    environment_variables: list[AgentEnvironmentVariableData] = []
    seen_keys: set[str] = set()
    for entry in parsed:
        if not isinstance(entry, dict):
            continue
        key = entry.get("key")
        env_value = entry.get("value")
        if not isinstance(key, str) or not isinstance(env_value, str):
            continue
        normalized_key = key.strip()
        if (
            not normalized_key
            or len(normalized_key) > MAX_ENVIRONMENT_VARIABLE_KEY_LENGTH
            or not _ENVIRONMENT_VARIABLE_KEY_RE.match(normalized_key)
        ):
            continue
        if normalized_key in seen_keys or len(env_value) > MAX_ENVIRONMENT_VARIABLE_VALUE_LENGTH:
            continue
        seen_keys.add(normalized_key)
        environment_variables.append(AgentEnvironmentVariableData(key=normalized_key, value=env_value))

    return environment_variables


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
