from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.modules.shared.schemas import DashboardModel


class PlanRoleProgress(DashboardModel):
    role: str
    total_checkpoints: int
    done_checkpoints: int


class PlanOverallProgress(DashboardModel):
    total_checkpoints: int
    done_checkpoints: int
    percent_complete: int


class PlanCheckpoint(DashboardModel):
    timestamp: str
    role: str
    checkpoint_id: str
    state: str
    message: str


class OpenSpecPlanSummary(DashboardModel):
    slug: str
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
    summary_markdown: str
    roles: list[PlanRoleProgress]
    overall_progress: PlanOverallProgress
    current_checkpoint: PlanCheckpoint | None


class OpenSpecPlansResponse(DashboardModel):
    entries: list[OpenSpecPlanSummary]


class OpenSpecPlanRoleDetail(DashboardModel):
    role: str
    total_checkpoints: int
    done_checkpoints: int
    tasks_markdown: str
    checkpoints_markdown: str | None


class PlanPromptItem(DashboardModel):
    id: str
    title: str
    content: str
    source_path: str


class PlanPromptBundle(DashboardModel):
    id: str
    title: str
    source_path: str
    prompts: list[PlanPromptItem] = Field(default_factory=list)


class OpenSpecPlanDetail(DashboardModel):
    slug: str
    title: str
    status: str
    created_at: datetime
    updated_at: datetime
    summary_markdown: str
    checkpoints_markdown: str
    roles: list[OpenSpecPlanRoleDetail]
    overall_progress: PlanOverallProgress
    current_checkpoint: PlanCheckpoint | None
    prompt_bundles: list[PlanPromptBundle] = Field(default_factory=list)


class PlanRuntimeAgent(DashboardModel):
    name: str
    role: str | None
    model: str | None
    status: str | None
    started_at: str | None
    updated_at: str | None
    source: str
    authoritative: bool


class PlanRuntimeEvent(DashboardModel):
    ts: str
    kind: str
    message: str
    agent_name: str | None
    role: str | None
    model: str | None
    status: str | None
    source: str
    authoritative: bool


class PlanRuntimeError(DashboardModel):
    timestamp: str
    code: str | None
    message: str
    source: str | None
    recoverable: bool | None


class OpenSpecPlanRuntime(DashboardModel):
    available: bool
    session_id: str | None
    correlation_confidence: str | None
    mode: str | None
    phase: str | None
    active: bool
    updated_at: datetime | None
    agents: list[PlanRuntimeAgent]
    events: list[PlanRuntimeEvent]
    last_checkpoint: PlanCheckpoint | None
    last_error: PlanRuntimeError | None
    can_resume: bool
    partial: bool
    stale_after_seconds: int | None
    reasons: list[str]
    unavailable_reason: str | None
