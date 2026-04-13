from __future__ import annotations

from datetime import datetime

from app.modules.shared.schemas import DashboardModel


class WorkspaceEntry(DashboardModel):
    id: str
    name: str
    slug: str
    label: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class WorkspacesResponse(DashboardModel):
    entries: list[WorkspaceEntry]


class WorkspaceCreateRequest(DashboardModel):
    name: str
    label: str | None = None


class WorkspaceSelectionResponse(DashboardModel):
    active_workspace_id: str

