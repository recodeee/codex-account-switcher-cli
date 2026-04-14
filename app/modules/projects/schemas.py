from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.modules.shared.schemas import DashboardModel


class ProjectEntry(DashboardModel):
    id: str
    name: str
    description: str | None
    project_url: str | None
    github_repo_url: str | None
    project_path: str | None
    sandbox_mode: Literal["read-only", "workspace-write", "danger-full-access"]
    git_branch: str | None
    created_at: datetime
    updated_at: datetime


class ProjectsResponse(DashboardModel):
    entries: list[ProjectEntry]


class ProjectPlanLinkEntry(DashboardModel):
    project_id: str
    plan_count: int
    latest_plan_slug: str | None
    latest_plan_updated_at: datetime | None


class ProjectPlanLinksResponse(DashboardModel):
    entries: list[ProjectPlanLinkEntry]


class ProjectCreateRequest(DashboardModel):
    name: str
    description: str | None = None
    project_url: str | None = None
    github_repo_url: str | None = None
    project_path: str | None = None
    sandbox_mode: str | None = None
    git_branch: str | None = None


class ProjectUpdateRequest(DashboardModel):
    name: str
    description: str | None = None
    project_url: str | None = None
    github_repo_url: str | None = None
    project_path: str | None = None
    sandbox_mode: str | None = None
    git_branch: str | None = None


class ProjectDeleteResponse(DashboardModel):
    status: str


class ProjectOpenFolderRequest(DashboardModel):
    target: Literal["vscode", "file-manager"] = "vscode"


class ProjectOpenFolderResponse(DashboardModel):
    status: str
    project_path: str
    target: Literal["vscode", "file-manager"] = "vscode"
    editor: str | None = None
