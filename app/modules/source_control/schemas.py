from __future__ import annotations

from datetime import datetime
from typing import Literal

from app.modules.shared.schemas import DashboardModel

MergeState = Literal["merged", "ready", "diverged", "behind", "unknown"]
BotStatus = Literal["idle", "active"]


class SourceControlChangedFile(DashboardModel):
    path: str
    code: str
    staged: bool = False
    unstaged: bool = False


class SourceControlCommitPreview(DashboardModel):
    hash: str | None = None
    subject: str
    body: str | None = None
    author_name: str | None = None
    authored_at: datetime | None = None


class SourceControlBranchPreview(DashboardModel):
    name: str
    is_active: bool = False
    ahead: int = 0
    behind: int = 0
    merged_into_base: bool | None = None
    merge_state: MergeState = "unknown"


class SourceControlMergePreviewEntry(DashboardModel):
    branch: str
    merge_state: MergeState
    ahead: int = 0
    behind: int = 0


class SourceControlWorktreeEntry(DashboardModel):
    path: str
    branch: str | None = None
    is_current: bool = False


class SourceControlBotSyncEntry(DashboardModel):
    bot_name: str
    bot_status: BotStatus
    runtime: str
    matched_branch: str | None = None
    in_sync: bool = False
    branch_candidates: list[str] = []


class SourceControlPreviewResponse(DashboardModel):
    repository_root: str
    project_path: str | None = None
    active_branch: str
    base_branch: str
    dirty: bool
    refreshed_at: datetime
    changed_files: list[SourceControlChangedFile] = []
    commit_preview: SourceControlCommitPreview
    branches: list[SourceControlBranchPreview] = []
    merge_preview: list[SourceControlMergePreviewEntry] = []
    worktrees: list[SourceControlWorktreeEntry] = []
    gx_bots: list[SourceControlBotSyncEntry] = []
    quick_actions: list[str] = []

