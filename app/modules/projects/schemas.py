from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.modules.shared.schemas import DashboardModel


class ProjectEntry(DashboardModel):
    id: str
    name: str
    description: str | None
    project_path: str | None
    sandbox_mode: Literal["read-only", "workspace-write", "danger-full-access"]
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


class ProjectsResponse(DashboardModel):
    entries: list[ProjectEntry]


class ProjectCreateRequest(DashboardModel):
    name: str
    description: str | None = None
    project_path: str | None = None
    sandbox_mode: str | None = None
    git_branch: str | None = None


class ProjectUpdateRequest(DashboardModel):
    name: str
    description: str | None = None
    project_path: str | None = None
    sandbox_mode: str | None = None
    git_branch: str | None = None


class ProjectDeleteResponse(DashboardModel):
    status: str
