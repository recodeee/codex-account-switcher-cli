from __future__ import annotations

from datetime import datetime
from typing import List, Literal

from pydantic import Field

from app.modules.shared.schemas import DashboardModel


class UsageTrendPoint(DashboardModel):
    t: datetime
    v: float


class AccountUsageTrend(DashboardModel):
    primary: list[UsageTrendPoint] = Field(default_factory=list)
    secondary: list[UsageTrendPoint] = Field(default_factory=list)


class AccountUsage(DashboardModel):
    primary_remaining_percent: float | None = None
    secondary_remaining_percent: float | None = None


class AccountRequestUsage(DashboardModel):
    request_count: int = 0
    total_tokens: int = 0
    output_tokens: int = 0
    cached_input_tokens: int = 0
    cache_write_tokens: int = 0
    total_cost_usd: float = 0.0


class AccountTokenStatus(DashboardModel):
    expires_at: datetime | None = None
    state: str | None = None


class AccountAuthStatus(DashboardModel):
    access: AccountTokenStatus | None = None
    refresh: AccountTokenStatus | None = None
    id_token: AccountTokenStatus | None = None


class AccountCodexAuthStatus(DashboardModel):
    has_snapshot: bool = False
    snapshot_name: str | None = None
    active_snapshot_name: str | None = None
    is_active_snapshot: bool = False
    has_live_session: bool = False
    live_usage_confidence: Literal["high", "low"] | None = None
    expected_snapshot_name: str | None = None
    snapshot_name_matches_email: bool = False
    runtime_ready: bool = False
    runtime_ready_source: Literal["validated_snapshot_email_match"] | None = None
    is_omx_boosted: bool = False
    runtime_mode: Literal["local", "cloud"] = "local"
    daemon_id: str | None = None
    device: str | None = None
    cli_version: str | None = None
    latest_cli_version: str | None = None
    cli_update_available: bool = False
    cli_update_command: str | None = None


class AccountAdditionalWindow(DashboardModel):
    used_percent: float
    reset_at: int | None = None
    window_minutes: int | None = None


class AccountAdditionalQuota(DashboardModel):
    quota_key: str | None = None
    limit_name: str
    metered_feature: str
    display_label: str | None = None
    primary_window: AccountAdditionalWindow | None = None
    secondary_window: AccountAdditionalWindow | None = None


class AccountLiveQuotaDebugWindow(DashboardModel):
    used_percent: float
    remaining_percent: float
    reset_at: int | None = None
    window_minutes: int | None = None


class AccountLiveQuotaDebugSample(DashboardModel):
    source: str
    snapshot_name: str | None = None
    recorded_at: datetime
    stale: bool = False
    primary: AccountLiveQuotaDebugWindow | None = None
    secondary: AccountLiveQuotaDebugWindow | None = None


class AccountLiveQuotaDebug(DashboardModel):
    snapshots_considered: list[str] = Field(default_factory=list)
    raw_samples: list[AccountLiveQuotaDebugSample] = Field(default_factory=list)
    merged: AccountLiveQuotaDebugSample | None = None
    override_applied: bool = False
    override_reason: str | None = None


class AccountSessionTaskPreview(DashboardModel):
    session_key: str
    task_preview: str | None = None
    task_updated_at: datetime | None = None


class AccountSummary(DashboardModel):
    account_id: str
    email: str
    display_name: str
    plan_type: str
    status: str
    usage: AccountUsage | None = None
    reset_at_primary: datetime | None = None
    reset_at_secondary: datetime | None = None
    last_usage_recorded_at_primary: datetime | None = None
    last_usage_recorded_at_secondary: datetime | None = None
    window_minutes_primary: int | None = None
    window_minutes_secondary: int | None = None
    last_refresh_at: datetime | None = None
    capacity_credits_primary: float | None = None
    remaining_credits_primary: float | None = None
    capacity_credits_secondary: float | None = None
    remaining_credits_secondary: float | None = None
    request_usage: AccountRequestUsage | None = None
    codex_live_session_count: int = 0
    codex_tracked_session_count: int = 0
    codex_session_count: int = 0
    codex_current_task_preview: str | None = None
    codex_last_task_preview: str | None = None
    codex_session_task_previews: list[AccountSessionTaskPreview] = Field(default_factory=list)
    live_quota_debug: AccountLiveQuotaDebug | None = None
    additional_quotas: list[AccountAdditionalQuota] = Field(default_factory=list)
    deactivation_reason: str | None = None
    auth: AccountAuthStatus | None = None
    codex_auth: AccountCodexAuthStatus | None = None


class AccountsResponse(DashboardModel):
    accounts: List[AccountSummary] = Field(default_factory=list)


class AccountImportResponse(DashboardModel):
    account_id: str
    email: str
    plan_type: str
    status: str


class AccountPauseResponse(DashboardModel):
    status: str


class AccountReactivateResponse(DashboardModel):
    status: str


class AccountDeleteResponse(DashboardModel):
    status: str


class AccountUseLocalResponse(DashboardModel):
    status: str
    account_id: str
    snapshot_name: str


class AccountRefreshAuthResponse(DashboardModel):
    status: str
    account_id: str
    email: str
    plan_type: str


class AccountOpenTerminalResponse(DashboardModel):
    status: str
    account_id: str
    snapshot_name: str


class AccountTerminateCliSessionsResponse(DashboardModel):
    status: str
    account_id: str
    snapshot_name: str
    terminated_session_count: int


class AccountSnapshotRepairResponse(DashboardModel):
    status: str
    account_id: str
    previous_snapshot_name: str
    snapshot_name: str
    mode: str
    changed: bool


class AccountTrendsResponse(DashboardModel):
    account_id: str
    primary: list[UsageTrendPoint] = Field(default_factory=list)
    secondary: list[UsageTrendPoint] = Field(default_factory=list)
