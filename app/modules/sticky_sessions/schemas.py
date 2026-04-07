from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.db.models import StickySessionKind
from app.modules.shared.schemas import DashboardModel


class StickySessionEntryResponse(DashboardModel):
    key: str
    account_id: str
    display_name: str
    kind: StickySessionKind
    created_at: datetime
    updated_at: datetime
    task_preview: str | None = None
    task_updated_at: datetime | None = None
    is_active: bool = False
    expires_at: datetime | None = None
    is_stale: bool


class UnmappedCliSessionResponse(DashboardModel):
    snapshot_name: str
    process_session_count: int = 0
    runtime_session_count: int = 0
    total_session_count: int = 0
    reason: str = "No account matched this snapshot."


class StickySessionsListResponse(DashboardModel):
    entries: list[StickySessionEntryResponse] = Field(default_factory=list)
    unmapped_cli_sessions: list[UnmappedCliSessionResponse] = Field(default_factory=list)
    stale_prompt_cache_count: int = 0
    total: int = 0
    has_more: bool = False


class StickySessionIdentifier(DashboardModel):
    key: str = Field(min_length=1)
    kind: StickySessionKind


class StickySessionDeleteResponse(DashboardModel):
    status: str


class StickySessionsDeleteRequest(DashboardModel):
    sessions: list[StickySessionIdentifier] = Field(min_length=1, max_length=500)


class StickySessionsDeleteResponse(DashboardModel):
    deleted_count: int


class StickySessionsPurgeRequest(DashboardModel):
    stale_only: Literal[True] = True


class StickySessionsPurgeResponse(DashboardModel):
    deleted_count: int


class StickySessionEventResponse(DashboardModel):
    timestamp: datetime
    kind: Literal["prompt", "answer", "thinking", "tool", "status", "event"]
    title: str
    text: str
    role: str | None = None
    raw_type: str | None = None


class StickySessionEventsResponse(DashboardModel):
    session_key: str
    resolved_session_id: str | None = None
    source_file: str | None = None
    events: list[StickySessionEventResponse] = Field(default_factory=list)
    truncated: bool = False
