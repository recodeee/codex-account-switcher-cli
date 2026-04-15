from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from app.modules.shared.schemas import DashboardModel

MergeState = Literal["merged", "ready", "diverged", "behind", "unknown"]
BotStatus = Literal["idle", "active"]
PullRequestState = Literal["open", "merged", "closed"]
ReviewContentKind = Literal["review", "comment", "decision"]
CheckConclusion = Literal[
    "failure",
    "timed_out",
    "cancelled",
    "action_required",
    "startup_failure",
    "stale",
    "neutral",
    "success",
    "skipped",
    "pending",
    "unknown",
]


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


class SourceControlCommitActivityEntry(DashboardModel):
    hash: str
    subject: str
    authored_at: datetime
    url: str | None = None


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
    branch_candidates: list[str] = Field(default_factory=list)
    source: Literal["agent", "snapshot"] = "agent"
    snapshot_name: str | None = None
    session_count: int = 0


class SourceControlReviewContent(DashboardModel):
    kind: ReviewContentKind
    content: str
    state: str | None = None
    author: str | None = None
    submitted_at: datetime | None = None
    url: str | None = None


class SourceControlPullRequestPreview(DashboardModel):
    number: int
    title: str
    state: PullRequestState = "open"
    head_branch: str
    base_branch: str
    url: str | None = None
    author: str | None = None
    is_draft: bool = False


class SourceControlFailedCheck(DashboardModel):
    name: str
    workflow_name: str | None = None
    conclusion: CheckConclusion = "unknown"
    details_url: str | None = None


class SourceControlReviewFeedbackEntry(DashboardModel):
    source: Literal["issue_comment", "review", "review_comment"] = "review"
    content: str
    state: str | None = None
    author: str | None = None
    file_path: str | None = None
    submitted_at: datetime | None = None
    url: str | None = None


class SourceControlPullRequestDiagnostics(DashboardModel):
    pull_request: SourceControlPullRequestPreview
    mergeable: str | None = None
    merge_state_status: str | None = None
    has_merge_conflicts: bool = False
    failed_checks: list[SourceControlFailedCheck] = Field(default_factory=list)
    feedback: list[SourceControlReviewFeedbackEntry] = Field(default_factory=list)


class SourceControlPreviewResponse(DashboardModel):
    repository_root: str
    project_path: str | None = None
    active_branch: str
    base_branch: str
    dirty: bool
    refreshed_at: datetime
    changed_files: list[SourceControlChangedFile] = Field(default_factory=list)
    commit_preview: SourceControlCommitPreview
    branches: list[SourceControlBranchPreview] = Field(default_factory=list)
    merge_preview: list[SourceControlMergePreviewEntry] = Field(default_factory=list)
    worktrees: list[SourceControlWorktreeEntry] = Field(default_factory=list)
    gx_bots: list[SourceControlBotSyncEntry] = Field(default_factory=list)
    pull_requests: list[SourceControlPullRequestPreview] = Field(default_factory=list)
    conflicted_pull_requests: list[SourceControlPullRequestDiagnostics] = Field(default_factory=list)
    bot_feedback_pull_requests: list[SourceControlPullRequestDiagnostics] = Field(default_factory=list)
    quick_actions: list[str] = Field(default_factory=list)


class SourceControlCommitActivityResponse(DashboardModel):
    repository_root: str
    project_path: str | None = None
    commits: list[SourceControlCommitActivityEntry] = Field(default_factory=list)


class SourceControlBranchDetailsResponse(DashboardModel):
    repository_root: str
    project_path: str | None = None
    branch: str
    base_branch: str
    merge_state: MergeState
    ahead: int = 0
    behind: int = 0
    changed_files: list[SourceControlChangedFile] = Field(default_factory=list)
    linked_bots: list[str] = Field(default_factory=list)
    pull_request: SourceControlPullRequestPreview | None = None
    review_content: SourceControlReviewContent | None = None


class SourceControlCreatePullRequestRequest(DashboardModel):
    project_id: str | None = None
    branch: str
    base_branch: str | None = None
    title: str | None = None
    body: str | None = None
    draft: bool = False


class SourceControlCreatePullRequestResponse(DashboardModel):
    status: Literal["created"]
    branch: str
    base_branch: str
    pull_request: SourceControlPullRequestPreview | None = None
    message: str


class SourceControlMergePullRequestRequest(DashboardModel):
    project_id: str | None = None
    branch: str
    pull_request_number: int | None = None
    base_branch: str | None = None
    delete_branch: bool = True
    squash: bool = False


class SourceControlMergePullRequestResponse(DashboardModel):
    status: Literal["merged"]
    branch: str
    pull_request_number: int | None = None
    message: str


class SourceControlDeleteBranchRequest(DashboardModel):
    project_id: str | None = None
    branch: str


class SourceControlDeleteBranchResponse(DashboardModel):
    status: Literal["deleted"]
    branch: str
    message: str
