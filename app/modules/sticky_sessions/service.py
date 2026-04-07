from __future__ import annotations

import json
import os
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
import re
from typing import Any, Literal

from app.modules.accounts.codex_auth_switcher import (
    build_snapshot_index,
    resolve_snapshot_names_for_account,
)
from app.modules.accounts.codex_live_usage import (
    LocalCodexTaskPreview,
    read_local_codex_task_previews_by_session_id,
    read_live_codex_process_session_counts_by_snapshot,
    read_runtime_live_session_counts_by_snapshot,
)
from app.modules.accounts.repository import AccountsRepository
from app.core.utils.time import to_utc_naive, utcnow
from app.db.models import StickySessionKind
from app.modules.proxy.sticky_repository import StickySessionListEntryRecord, StickySessionsRepository
from app.modules.settings.repository import SettingsRepository

_ACTIVE_SESSION_WINDOW_SECONDS = 30 * 60
_SESSION_ID_FROM_KEY_RE = re.compile(r"([0-9a-fA-F-]{36})")
_ROLLOUT_USER_CONTENT_TAGS = {"input_text", "text", "user_text"}
_ROLLOUT_ASSISTANT_CONTENT_TAGS = {"output_text", "text", "assistant_text"}
_ROLLOUT_MAX_TEXT_LENGTH = 600


@dataclass(frozen=True, slots=True)
class StickySessionEntryData:
    key: str
    account_id: str
    display_name: str
    kind: StickySessionKind
    created_at: datetime
    updated_at: datetime
    task_preview: str | None
    task_updated_at: datetime | None
    is_active: bool
    expires_at: datetime | None
    is_stale: bool


@dataclass(frozen=True, slots=True)
class StickySessionListData:
    entries: list[StickySessionEntryData]
    unmapped_cli_sessions: list["UnmappedCliSessionData"]
    stale_prompt_cache_count: int
    total: int
    has_more: bool


@dataclass(frozen=True, slots=True)
class UnmappedCliSessionData:
    snapshot_name: str
    process_session_count: int
    runtime_session_count: int
    total_session_count: int
    reason: str


@dataclass(frozen=True, slots=True)
class StickySessionEventData:
    timestamp: datetime
    kind: Literal["prompt", "answer", "thinking", "tool", "status", "event"]
    title: str
    text: str
    role: str | None
    raw_type: str | None


@dataclass(frozen=True, slots=True)
class StickySessionEventsData:
    session_key: str
    resolved_session_id: str | None
    source_file: str | None
    events: list[StickySessionEventData]
    truncated: bool


class StickySessionsService:
    def __init__(
        self,
        repository: StickySessionsRepository,
        settings_repository: SettingsRepository,
        accounts_repository: AccountsRepository,
    ) -> None:
        self._repository = repository
        self._settings_repository = settings_repository
        self._accounts_repository = accounts_repository

    async def list_entries(
        self,
        *,
        kind: StickySessionKind | None = None,
        stale_only: bool = False,
        active_only: bool = False,
        offset: int = 0,
        limit: int = 100,
    ) -> StickySessionListData:
        settings = await self._settings_repository.get_or_create()
        ttl_seconds = settings.openai_cache_affinity_max_age_seconds
        stale_cutoff = utcnow() - timedelta(seconds=ttl_seconds)
        active_cutoff = utcnow() - timedelta(seconds=_ACTIVE_SESSION_WINDOW_SECONDS) if active_only else None
        stale_prompt_cache_count = await self._count_stale_prompt_cache_entries(kind=kind, stale_cutoff=stale_cutoff)
        unmapped_cli_sessions = await self._list_unmapped_cli_sessions()
        if stale_only and kind not in (None, StickySessionKind.PROMPT_CACHE):
            return StickySessionListData(
                entries=[],
                unmapped_cli_sessions=unmapped_cli_sessions,
                stale_prompt_cache_count=stale_prompt_cache_count,
                total=0,
                has_more=False,
            )
        effective_kind = StickySessionKind.PROMPT_CACHE if stale_only else kind
        total = await self._repository.count_entries(
            kind=effective_kind,
            updated_after=active_cutoff,
            updated_before=stale_cutoff if stale_only else None,
        )
        rows = await self._repository.list_entries(
            kind=effective_kind,
            updated_after=active_cutoff,
            updated_before=stale_cutoff if stale_only else None,
            offset=offset,
            limit=limit,
        )
        codex_session_task_previews_by_session_id = read_local_codex_task_previews_by_session_id()
        entries = [
            self._to_entry(
                row,
                ttl_seconds=ttl_seconds,
                codex_session_task_previews_by_session_id=codex_session_task_previews_by_session_id,
            )
            for row in rows
        ]
        return StickySessionListData(
            entries=entries,
            unmapped_cli_sessions=unmapped_cli_sessions,
            stale_prompt_cache_count=stale_prompt_cache_count,
            total=total,
            has_more=offset + len(entries) < total,
        )

    async def delete_entry(self, key: str, *, kind: StickySessionKind) -> bool:
        return await self._repository.delete(key, kind=kind)

    async def delete_entries(self, entries: Sequence[tuple[str, StickySessionKind]]) -> int:
        return await self._repository.delete_entries(entries)

    async def purge_entries(self) -> int:
        settings = await self._settings_repository.get_or_create()
        cutoff = utcnow() - timedelta(seconds=settings.openai_cache_affinity_max_age_seconds)
        return await self._repository.purge_prompt_cache_before(cutoff)

    async def get_codex_session_events(
        self,
        *,
        account_id: str,
        session_key: str,
        limit: int = 120,
    ) -> StickySessionEventsData | None:
        sticky_row = await self._repository.get_entry(session_key, kind=StickySessionKind.CODEX_SESSION)
        if sticky_row is None or sticky_row.account_id != account_id:
            return None

        normalized_limit = max(1, min(limit, 500))
        session_id = _extract_session_id_from_key(session_key)
        if session_id is None:
            return StickySessionEventsData(
                session_key=session_key,
                resolved_session_id=None,
                source_file=None,
                events=[],
                truncated=False,
            )

        rollout_path = _resolve_latest_rollout_file_for_session_id(session_id)
        if rollout_path is None:
            return StickySessionEventsData(
                session_key=session_key,
                resolved_session_id=session_id,
                source_file=None,
                events=[],
                truncated=False,
            )

        events, truncated = _parse_rollout_events(path=rollout_path, limit=normalized_limit)
        return StickySessionEventsData(
            session_key=session_key,
            resolved_session_id=session_id,
            source_file=str(rollout_path),
            events=events,
            truncated=truncated,
        )

    def _to_entry(
        self,
        row: StickySessionListEntryRecord,
        *,
        ttl_seconds: int,
        codex_session_task_previews_by_session_id: dict[str, LocalCodexTaskPreview],
    ) -> StickySessionEntryData:
        sticky_session = row.sticky_session
        expires_at: datetime | None = None
        is_stale = False
        if sticky_session.kind == StickySessionKind.PROMPT_CACHE:
            expires_at = to_utc_naive(sticky_session.updated_at) + timedelta(seconds=ttl_seconds)
            is_stale = expires_at <= utcnow()
        is_active = to_utc_naive(sticky_session.updated_at) >= utcnow() - timedelta(seconds=_ACTIVE_SESSION_WINDOW_SECONDS)
        task_preview = sticky_session.task_preview
        task_updated_at = sticky_session.task_updated_at
        if sticky_session.kind == StickySessionKind.CODEX_SESSION and not task_preview:
            session_id = _extract_session_id_from_key(sticky_session.key)
            if session_id is not None:
                preview = codex_session_task_previews_by_session_id.get(session_id)
                if preview is not None:
                    task_preview = preview.text
                    task_updated_at = preview.recorded_at
        return StickySessionEntryData(
            key=sticky_session.key,
            account_id=sticky_session.account_id,
            display_name=row.display_name,
            kind=sticky_session.kind,
            created_at=sticky_session.created_at,
            updated_at=sticky_session.updated_at,
            task_preview=task_preview,
            task_updated_at=task_updated_at,
            is_active=is_active,
            expires_at=expires_at,
            is_stale=is_stale,
        )

    async def _count_stale_prompt_cache_entries(
        self,
        *,
        kind: StickySessionKind | None,
        stale_cutoff: datetime,
    ) -> int:
        if kind not in (None, StickySessionKind.PROMPT_CACHE):
            return 0
        return await self._repository.count_entries(
            kind=StickySessionKind.PROMPT_CACHE,
            updated_before=stale_cutoff,
        )

    async def _list_unmapped_cli_sessions(self) -> list[UnmappedCliSessionData]:
        process_counts_by_snapshot = read_live_codex_process_session_counts_by_snapshot()
        runtime_counts_by_snapshot = read_runtime_live_session_counts_by_snapshot()
        if not process_counts_by_snapshot and not runtime_counts_by_snapshot:
            return []

        snapshot_index = build_snapshot_index()
        accounts = await self._accounts_repository.list_accounts()
        mapped_snapshot_names: set[str] = set()
        for account in accounts:
            snapshot_names = resolve_snapshot_names_for_account(
                snapshot_index=snapshot_index,
                account_id=account.id,
                chatgpt_account_id=account.chatgpt_account_id,
                email=account.email,
            )
            mapped_snapshot_names.update(
                snapshot_name.strip().lower()
                for snapshot_name in snapshot_names
                if snapshot_name.strip()
            )

        all_snapshot_names = (
            set(process_counts_by_snapshot.keys())
            | set(runtime_counts_by_snapshot.keys())
        )
        unmapped: list[UnmappedCliSessionData] = []
        for snapshot_name in all_snapshot_names:
            normalized_snapshot = snapshot_name.strip().lower()
            if not normalized_snapshot:
                continue

            process_count = max(0, int(process_counts_by_snapshot.get(snapshot_name, 0)))
            runtime_count = max(0, int(runtime_counts_by_snapshot.get(snapshot_name, 0)))
            total_count = max(process_count, runtime_count)
            if total_count <= 0:
                continue
            if normalized_snapshot in mapped_snapshot_names:
                continue

            unmapped.append(
                UnmappedCliSessionData(
                    snapshot_name=snapshot_name,
                    process_session_count=process_count,
                    runtime_session_count=runtime_count,
                    total_session_count=total_count,
                    reason="No account matched this snapshot.",
                )
            )

        return sorted(
            unmapped,
            key=lambda item: (
                -item.total_session_count,
                -item.process_session_count,
                -item.runtime_session_count,
                item.snapshot_name,
            ),
        )


def _extract_session_id_from_key(key: str) -> str | None:
    match = _SESSION_ID_FROM_KEY_RE.search(key)
    if match is None:
        return None
    return match.group(1)


def _resolve_latest_rollout_file_for_session_id(session_id: str) -> Path | None:
    candidate_files: list[Path] = []
    for sessions_dir in _iter_sessions_dirs():
        if not sessions_dir.exists() or not sessions_dir.is_dir():
            continue
        candidate_files.extend(sessions_dir.rglob(f"rollout-*-{session_id}.jsonl"))
    if not candidate_files:
        return None
    candidate_files.sort(key=_safe_mtime, reverse=True)
    return candidate_files[0]


def _iter_sessions_dirs() -> list[Path]:
    directories: list[Path] = []

    default_sessions_dir = _resolve_sessions_dir()
    directories.append(default_sessions_dir)

    runtime_root = _resolve_runtime_root()
    if runtime_root.exists() and runtime_root.is_dir():
        for runtime_dir in runtime_root.iterdir():
            if not runtime_dir.is_dir():
                continue
            directories.append((runtime_dir / "sessions").resolve())

    unique_directories: list[Path] = []
    seen: set[str] = set()
    for directory in directories:
        key = str(directory)
        if key in seen:
            continue
        seen.add(key)
        unique_directories.append(directory)
    return unique_directories


def _resolve_sessions_dir() -> Path:
    sessions_raw = os.environ.get("CODEX_SESSIONS_DIR")
    if sessions_raw:
        return Path(sessions_raw).expanduser().resolve()

    auth_raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if auth_raw:
        auth_path = Path(auth_raw).expanduser().resolve()
        return (auth_path.parent / "sessions").resolve()

    return (Path.home() / ".codex" / "sessions").resolve()


def _resolve_runtime_root() -> Path:
    runtime_raw = os.environ.get("CODEX_AUTH_RUNTIME_ROOT")
    if runtime_raw:
        return Path(runtime_raw).expanduser().resolve()
    return (Path.home() / ".codex" / "runtimes").resolve()


def _parse_rollout_events(
    *,
    path: Path,
    limit: int,
) -> tuple[list[StickySessionEventData], bool]:
    if limit <= 0:
        return ([], False)

    parsed_events: list[StickySessionEventData] = []
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            lines = handle.readlines()
    except OSError:
        return ([], False)

    for line in lines:
        event = _parse_rollout_event_line(line)
        if event is not None:
            parsed_events.append(event)

    if len(parsed_events) <= limit:
        return (parsed_events, False)
    return (parsed_events[-limit:], True)


def _parse_rollout_event_line(raw_line: str) -> StickySessionEventData | None:
    line = raw_line.strip()
    if not line:
        return None

    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    timestamp = _parse_rollout_timestamp(payload.get("timestamp"))
    if timestamp is None:
        return None

    event_type = payload.get("type")
    if not isinstance(event_type, str) or not event_type.strip():
        return None

    if event_type in {"response.completed", "response_completed"}:
        return StickySessionEventData(
            timestamp=timestamp,
            kind="status",
            title="Response completed",
            text="Assistant finished this response.",
            role=None,
            raw_type=event_type,
        )

    if event_type == "response_item":
        message_event = _parse_rollout_response_item_event(payload=payload, timestamp=timestamp)
        if message_event is not None:
            return message_event
        return StickySessionEventData(
            timestamp=timestamp,
            kind="event",
            title="Response item",
            text="Received a response item event.",
            role=None,
            raw_type=event_type,
        )

    if event_type == "event_msg":
        return _parse_rollout_event_msg(payload=payload, timestamp=timestamp, event_type=event_type)

    if "delta" in event_type:
        return StickySessionEventData(
            timestamp=timestamp,
            kind="thinking",
            title=event_type,
            text="Streaming delta event.",
            role=None,
            raw_type=event_type,
        )

    return StickySessionEventData(
        timestamp=timestamp,
        kind="event",
        title=event_type,
        text="Telemetry event.",
        role=None,
        raw_type=event_type,
    )


def _parse_rollout_response_item_event(
    *,
    payload: dict[str, Any],
    timestamp: datetime,
) -> StickySessionEventData | None:
    item_payload = payload.get("payload")
    if not isinstance(item_payload, dict):
        return None

    item_type = item_payload.get("type")
    if not isinstance(item_type, str):
        return None

    if item_type == "message":
        role = item_payload.get("role")
        normalized_role = role.strip().lower() if isinstance(role, str) else None
        text = _extract_message_text(
            item_payload.get("content"),
            role=normalized_role,
        )
        if not text:
            return None
        if normalized_role == "user":
            return StickySessionEventData(
                timestamp=timestamp,
                kind="prompt",
                title="Prompt",
                text=text,
                role="user",
                raw_type="response_item:message:user",
            )
        if normalized_role == "assistant":
            return StickySessionEventData(
                timestamp=timestamp,
                kind="answer",
                title="Assistant answer",
                text=text,
                role="assistant",
                raw_type="response_item:message:assistant",
            )
        return StickySessionEventData(
            timestamp=timestamp,
            kind="event",
            title="Message event",
            text=text,
            role=normalized_role,
            raw_type="response_item:message",
        )

    if item_type in {"function_call", "tool_call"}:
        function_name = _extract_first_string(
            item_payload.get("name"),
            item_payload.get("tool_name"),
            _extract_nested_mapping_value(item_payload.get("function"), "name"),
        ) or "tool_call"
        arguments = _extract_first_string(
            item_payload.get("arguments"),
            _extract_nested_mapping_value(item_payload.get("function"), "arguments"),
        )
        text = function_name if not arguments else f"{function_name}({arguments})"
        return StickySessionEventData(
            timestamp=timestamp,
            kind="tool",
            title="Tool call",
            text=_truncate_event_text(text),
            role="assistant",
            raw_type=f"response_item:{item_type}",
        )

    if item_type == "function_call_output":
        output = _extract_first_string(item_payload.get("output")) or "Tool output captured."
        return StickySessionEventData(
            timestamp=timestamp,
            kind="tool",
            title="Tool output",
            text=_truncate_event_text(output),
            role="tool",
            raw_type="response_item:function_call_output",
        )

    if "reasoning" in item_type:
        summary = _extract_first_string(
            item_payload.get("summary"),
            item_payload.get("content"),
        ) or "Reasoning event captured."
        return StickySessionEventData(
            timestamp=timestamp,
            kind="thinking",
            title="Reasoning",
            text=_truncate_event_text(summary),
            role="assistant",
            raw_type=f"response_item:{item_type}",
        )

    return StickySessionEventData(
        timestamp=timestamp,
        kind="event",
        title=f"Response item: {item_type}",
        text="Structured response item event.",
        role=None,
        raw_type=f"response_item:{item_type}",
    )


def _parse_rollout_event_msg(
    *,
    payload: dict[str, Any],
    timestamp: datetime,
    event_type: str,
) -> StickySessionEventData:
    event_payload = payload.get("payload")
    if not isinstance(event_payload, dict):
        return StickySessionEventData(
            timestamp=timestamp,
            kind="event",
            title=event_type,
            text="Runtime event payload unavailable.",
            role=None,
            raw_type=event_type,
        )

    message_type = event_payload.get("type")
    message_type_label = message_type.strip() if isinstance(message_type, str) else "event"

    if message_type == "task_started":
        return StickySessionEventData(
            timestamp=timestamp,
            kind="status",
            title="Task started",
            text="Session started processing a task.",
            role=None,
            raw_type="event_msg:task_started",
        )

    if message_type == "token_count":
        rate_limits = event_payload.get("rate_limits")
        summary = "Updated token usage telemetry."
        if isinstance(rate_limits, dict):
            primary = _extract_nested_mapping_value(rate_limits.get("primary"), "used_percent")
            secondary = _extract_nested_mapping_value(rate_limits.get("secondary"), "used_percent")
            if isinstance(primary, (float, int)) or isinstance(secondary, (float, int)):
                primary_text = f"{round(float(primary), 2)}%" if isinstance(primary, (float, int)) else "—"
                secondary_text = (
                    f"{round(float(secondary), 2)}%" if isinstance(secondary, (float, int)) else "—"
                )
                summary = f"5h used: {primary_text} · weekly used: {secondary_text}"
        return StickySessionEventData(
            timestamp=timestamp,
            kind="event",
            title="Token telemetry",
            text=summary,
            role=None,
            raw_type="event_msg:token_count",
        )

    return StickySessionEventData(
        timestamp=timestamp,
        kind="event",
        title=f"Runtime event: {message_type_label}",
        text="Session runtime event captured.",
        role=None,
        raw_type=f"event_msg:{message_type_label}",
    )


def _extract_message_text(content: Any, *, role: str | None) -> str | None:
    if isinstance(content, str):
        text = content.strip()
        return _truncate_event_text(text) if text else None
    if not isinstance(content, list):
        return None

    preferred_types = (
        _ROLLOUT_ASSISTANT_CONTENT_TAGS
        if role == "assistant"
        else _ROLLOUT_USER_CONTENT_TAGS
    )

    parts: list[str] = []
    for item in content:
        if not isinstance(item, dict):
            continue
        item_type = item.get("type")
        if isinstance(item_type, str) and preferred_types and item_type not in preferred_types:
            # Keep scanning; preferred tag types are cleaner for user/assistant transcript text.
            continue
        item_text = item.get("text")
        if isinstance(item_text, str) and item_text.strip():
            parts.append(item_text.strip())
            continue
        nested_text = _extract_nested_mapping_value(item, "content")
        if isinstance(nested_text, str) and nested_text.strip():
            parts.append(nested_text.strip())

    if not parts:
        for item in content:
            if not isinstance(item, dict):
                continue
            item_text = item.get("text")
            if isinstance(item_text, str) and item_text.strip():
                parts.append(item_text.strip())

    if not parts:
        return None
    return _truncate_event_text("\n".join(parts))


def _extract_nested_mapping_value(value: Any, key: str) -> Any | None:
    if not isinstance(value, dict):
        return None
    return value.get(key)


def _extract_first_string(*values: Any) -> str | None:
    for value in values:
        if isinstance(value, str):
            normalized = value.strip()
            if normalized:
                return normalized
    return None


def _truncate_event_text(text: str) -> str:
    normalized = " ".join(text.split())
    if len(normalized) <= _ROLLOUT_MAX_TEXT_LENGTH:
        return normalized
    return f"{normalized[:_ROLLOUT_MAX_TEXT_LENGTH].rstrip()}…"


def _parse_rollout_timestamp(raw_value: Any) -> datetime | None:
    if not isinstance(raw_value, str):
        return None
    normalized = raw_value.strip()
    if not normalized:
        return None
    if normalized.endswith("Z"):
        normalized = f"{normalized[:-1]}+00:00"
    try:
        timestamp = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if timestamp.tzinfo is None:
        return timestamp
    return timestamp.astimezone(timezone.utc)


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0
