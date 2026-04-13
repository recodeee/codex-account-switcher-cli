from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.modules.shared.schemas import DashboardModel


class AgentEntry(DashboardModel):
    id: str
    name: str
    status: Literal["idle", "active"]
    description: str | None
    visibility: Literal["workspace", "private"]
    runtime: str
    instructions: str
    max_concurrent_tasks: int
    avatar_data_url: str | None = None
    created_at: datetime
    updated_at: datetime


class AgentsResponse(DashboardModel):
    entries: list[AgentEntry]


class AgentCreateRequest(DashboardModel):
    name: str
    description: str | None = None
    visibility: str | None = None
    runtime: str | None = None
    instructions: str | None = None
    max_concurrent_tasks: int | None = None
    avatar_data_url: str | None = None


class AgentUpdateRequest(DashboardModel):
    name: str
    status: str | None = None
    description: str | None = None
    visibility: str | None = None
    runtime: str | None = None
    instructions: str | None = None
    max_concurrent_tasks: int | None = None
    avatar_data_url: str | None = None
