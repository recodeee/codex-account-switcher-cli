from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from pydantic import AliasChoices, Field

from app.modules.shared.schemas import DashboardModel


class RuntimeHandoffStatus(StrEnum):
    READY = "ready"
    RESUMED = "resumed"
    ABORTED = "aborted"
    EXPIRED = "expired"


class RuntimeHandoffTriggerReason(StrEnum):
    QUOTA_LOW = "quota_low"
    QUOTA_EXHAUSTED = "quota_exhausted"
    MANUAL_HANDOFF = "manual_handoff"


class RuntimeHandoffCheckpoint(DashboardModel):
    title: str | None = None
    goal: str = Field(min_length=1, max_length=5000)
    completed_work: list[str] = Field(
        default_factory=list,
        max_length=200,
        validation_alias=AliasChoices("completedWork", "completed_work", "done"),
    )
    next_steps: list[str] = Field(
        default_factory=list,
        max_length=200,
        validation_alias=AliasChoices("nextSteps", "next_steps", "next"),
    )
    blockers: list[str] = Field(default_factory=list, max_length=200)
    files_touched: list[str] = Field(default_factory=list, max_length=500)
    commands_run: list[str] = Field(default_factory=list, max_length=500)
    evidence_refs: list[str] = Field(default_factory=list, max_length=500)


class RuntimeHandoffEntry(DashboardModel):
    id: str = Field(min_length=1)
    schema_version: int = 1
    status: RuntimeHandoffStatus
    source_runtime: str = Field(min_length=1, max_length=120)
    source_snapshot: str = Field(min_length=1, max_length=120)
    source_session_id: str | None = None
    trigger_reason: RuntimeHandoffTriggerReason
    expected_target_runtime: str | None = None
    expected_target_snapshot: str | None = None
    target_runtime: str | None = None
    target_snapshot: str | None = None
    created_at: datetime
    expires_at: datetime
    last_resumed_at: datetime | None = None
    aborted_at: datetime | None = None
    resume_count: int = 0
    checksum: str = Field(min_length=32, max_length=64)
    checkpoint: RuntimeHandoffCheckpoint


class RuntimeHandoffListResponse(DashboardModel):
    entries: list[RuntimeHandoffEntry] = Field(default_factory=list)
    total: int = 0


class RuntimeHandoffCreateRequest(DashboardModel):
    source_runtime: str = Field(min_length=1, max_length=120)
    source_snapshot: str = Field(min_length=1, max_length=120)
    source_session_id: str | None = None
    trigger_reason: RuntimeHandoffTriggerReason
    expected_target_runtime: str | None = None
    expected_target_snapshot: str | None = None
    checkpoint: RuntimeHandoffCheckpoint
    ttl_hours: int | None = Field(default=None, ge=1, le=24 * 14)


class RuntimeHandoffResumeRequest(DashboardModel):
    target_runtime: str = Field(min_length=1, max_length=120)
    target_snapshot: str = Field(min_length=1, max_length=120)
    override_mismatch: bool = False


class RuntimeHandoffAbortRequest(DashboardModel):
    reason: str | None = Field(default=None, max_length=2000)


class RuntimeHandoffResumeResponse(DashboardModel):
    handoff: RuntimeHandoffEntry
    resume_prompt: str
