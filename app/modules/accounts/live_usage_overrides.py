from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import logging
import os
from pathlib import Path
import re
from typing import Literal

from app.core.utils.time import to_utc_naive
from app.db.models import Account, AccountStatus, UsageHistory
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalCodexLiveUsageSample,
    LocalUsageWindow,
    has_recent_active_snapshot_process_fallback,
    read_live_codex_process_session_counts_by_snapshot,
    read_local_codex_live_usage_by_snapshot,
    read_local_codex_live_usage_samples_by_snapshot,
    read_runtime_live_session_counts_by_snapshot,
)
from app.modules.accounts.schemas import (
    AccountCodexAuthStatus,
    AccountLiveQuotaDebug,
    AccountLiveQuotaDebugSample,
    AccountLiveQuotaDebugWindow,
)


@dataclass(frozen=True)
class LiveUsageOverridePersistCandidate:
    account_id: str
    window: Literal["primary", "secondary"]
    used_percent: float
    reset_at: int | None
    window_minutes: int | None
    recorded_at: datetime


_RESET_FINGERPRINT_MATCH_TOLERANCE_SECONDS = 30
_PERCENT_PATTERN_HIGH_CONFIDENCE_MAX_DISTANCE = 8.0
_PERCENT_PATTERN_HIGH_CONFIDENCE_MARGIN = 4.0
_LIVE_USAGE_DEBUG_ENV = "CODEX_LB_LIVE_USAGE_DEBUG"
_DEFAULT_SESSION_FINGERPRINT_FALLBACK_ENV = "CODEX_LB_DEFAULT_SESSION_FINGERPRINT_FALLBACK_ENABLED"
_ROLLOUT_SOURCE_SESSION_PREFIX_RE = re.compile(r"rollout-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})")
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _SampleMatchResult:
    account_id: str
    confidence: Literal["high", "low"]
    allows_quota_override: bool = False


@dataclass(frozen=True)
class _SampleAttribution:
    sample: LocalCodexLiveUsage
    match: _SampleMatchResult


@dataclass(frozen=True)
class _SampleSourceOwner:
    account_id: str
    observed_at: datetime


_SAMPLE_SOURCE_OWNER_TTL = timedelta(days=7)
_SAMPLE_SOURCE_OWNER_MAX_ENTRIES = 512
_sample_source_owner_cache: dict[str, _SampleSourceOwner] = {}


def apply_local_live_usage_overrides(
    *,
    accounts: list[Account],
    snapshot_index: CodexAuthSnapshotIndex,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    codex_live_session_counts_by_account: dict[str, int],
    live_quota_debug_by_account: dict[str, AccountLiveQuotaDebug] | None = None,
) -> list[LiveUsageOverridePersistCandidate]:
    baseline_primary_usage = dict(primary_usage)
    baseline_secondary_usage = dict(secondary_usage)
    persist_candidates: list[LiveUsageOverridePersistCandidate] = []
    live_usage_by_snapshot = read_local_codex_live_usage_by_snapshot()
    live_usage_samples_by_snapshot = read_local_codex_live_usage_samples_by_snapshot()
    live_process_session_counts_by_snapshot = read_live_codex_process_session_counts_by_snapshot()
    runtime_live_session_counts_by_snapshot = read_runtime_live_session_counts_by_snapshot()
    should_defer_active_snapshot_usage = _should_defer_active_snapshot_usage_override(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        live_usage_by_snapshot=live_usage_by_snapshot,
    )
    (
        debug_raw_samples_by_account,
        confident_raw_samples_by_account,
    ) = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
        live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
        should_defer_active_snapshot_usage=should_defer_active_snapshot_usage,
    )

    for account in accounts:
        codex_auth_status = codex_auth_by_account.get(account.id)
        if codex_auth_status is None:
            continue

        selected_snapshot_name = codex_auth_status.snapshot_name
        snapshot_names_from_index = snapshot_index.snapshots_by_account_id.get(account.id, [])
        if selected_snapshot_name:
            # Account status already resolves a single effective snapshot name.
            # Reuse it here so live-usage attribution/debug telemetry does not
            # accidentally merge stale aliases from snapshot index buckets,
            # even when legacy index metadata does not yet include the selected
            # snapshot in this account-id bucket.
            snapshot_names = [selected_snapshot_name]
        else:
            snapshot_names = snapshot_names_from_index
        snapshots_considered = _resolve_snapshot_candidates(
            snapshot_names=snapshot_names,
            selected_snapshot_name=selected_snapshot_name,
        )
        live_usage = _resolve_live_usage_for_account(
            snapshot_names=snapshot_names,
            selected_snapshot_name=selected_snapshot_name,
            live_usage_by_snapshot=live_usage_by_snapshot,
        )
        live_process_session_count = _resolve_live_process_session_count_for_account(
            snapshot_names=snapshot_names,
            selected_snapshot_name=selected_snapshot_name,
            live_process_session_counts_by_snapshot=live_process_session_counts_by_snapshot,
        )
        live_runtime_session_count = _resolve_live_runtime_session_count_for_account(
            snapshot_names=snapshot_names,
            selected_snapshot_name=selected_snapshot_name,
            runtime_live_session_counts_by_snapshot=runtime_live_session_counts_by_snapshot,
        )
        has_live_process_session = live_process_session_count > 0
        has_live_runtime_session = live_runtime_session_count > 0
        has_live_telemetry = bool(live_usage and live_usage.active_session_count > 0)
        if has_live_process_session or has_live_runtime_session:
            owned_samples: list[LocalCodexLiveUsageSample] = []
            for snapshot_name in snapshots_considered:
                owned_samples.extend(live_usage_samples_by_snapshot.get(snapshot_name, []))
            _remember_snapshot_sample_owners_for_account(
                account_id=account.id,
                samples=owned_samples,
            )
        # "Working now" must reflect live CLI processes only. Session-file
        # telemetry can still update quota windows, but it must not elevate
        # account live/session status by itself unless runtime-scoped session
        # files explicitly map to the account snapshot.
        codex_auth_status.has_live_session = has_live_process_session or has_live_runtime_session
        account_id = account.id
        override_reason: str | None = None
        override_applied = False
        raw_samples_override = debug_raw_samples_by_account.get(account_id)
        confident_raw_samples_override = confident_raw_samples_by_account.get(account_id)

        if has_live_process_session or has_live_runtime_session:
            codex_live_session_counts_by_account[account_id] = max(
                live_process_session_count,
                live_runtime_session_count,
                codex_live_session_counts_by_account.get(account_id, 0),
            )
        elif not has_live_telemetry:
            debug_live_usage = live_usage
            if codex_auth_status.is_active_snapshot:
                (
                    applied_confident_sample_override,
                    confident_sample_live_usage,
                ) = _apply_deferred_confident_sample_override(
                    account_id=account_id,
                    raw_samples_override=confident_raw_samples_override,
                    primary_usage=primary_usage,
                    secondary_usage=secondary_usage,
                    persist_candidates=persist_candidates,
                )
                if applied_confident_sample_override:
                    override_applied = True
                    override_reason = "no_live_telemetry_confident_sample_override"
                    if confident_sample_live_usage is not None:
                        debug_live_usage = confident_sample_live_usage
                else:
                    (
                        applied_sample_floor_override,
                        sample_floor_live_usage,
                    ) = _apply_deferred_sample_floor_override(
                        account_id=account_id,
                        snapshots_considered=snapshots_considered,
                        live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                        primary_usage=primary_usage,
                        secondary_usage=secondary_usage,
                        persist_candidates=persist_candidates,
                    )
                    if applied_sample_floor_override:
                        override_applied = True
                        override_reason = "no_live_telemetry_sample_floor_override"
                        if sample_floor_live_usage is not None:
                            debug_live_usage = sample_floor_live_usage
                    else:
                        override_reason = "no_live_telemetry"
            else:
                override_reason = "no_live_telemetry"

            if (
                not should_defer_active_snapshot_usage
                and _has_fresh_quota_sample_for_account(
                    snapshots_considered=snapshots_considered,
                    live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                    raw_samples_override=raw_samples_override,
                )
            ):
                codex_auth_status.has_live_session = True
                codex_live_session_counts_by_account[account_id] = max(
                    codex_live_session_counts_by_account.get(account_id, 0),
                    1,
                )

            _set_live_quota_debug(
                account_id=account_id,
                snapshots_considered=snapshots_considered,
                live_usage=debug_live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                raw_samples_override=raw_samples_override,
                override_applied=override_applied,
                override_reason=override_reason,
                live_quota_debug_by_account=live_quota_debug_by_account,
            )
            _log_live_quota_debug(
                account=account,
                snapshots_considered=snapshots_considered,
                live_usage=debug_live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                live_process_session_count=live_process_session_count,
                override_applied=override_applied,
                override_reason=override_reason,
            )
            continue

        if live_usage is None:
            override_reason = "missing_live_usage_payload"
            _set_live_quota_debug(
                account_id=account_id,
                snapshots_considered=snapshots_considered,
                live_usage=live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                raw_samples_override=raw_samples_override,
                override_applied=override_applied,
                override_reason=override_reason,
                live_quota_debug_by_account=live_quota_debug_by_account,
            )
            _log_live_quota_debug(
                account=account,
                snapshots_considered=snapshots_considered,
                live_usage=live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                live_process_session_count=live_process_session_count,
                override_applied=override_applied,
                override_reason=override_reason,
            )
            continue

        if (
            not has_live_process_session
            and not has_live_runtime_session
            and should_defer_active_snapshot_usage
            and codex_auth_status.is_active_snapshot
        ):
            debug_live_usage = live_usage
            # The default sessions directory can include active sessions from
            # multiple snapshots. When that mixed telemetry cannot be reliably
            # split yet, keep quota windows on their baseline account values
            # instead of attributing another snapshot's limits to the active
            # account.
            if account.status == AccountStatus.DEACTIVATED:
                applied_conservative_floor = _apply_deferred_conservative_floor(
                    account=account,
                    account_id=account_id,
                    live_usage=live_usage,
                    primary_usage=primary_usage,
                    secondary_usage=secondary_usage,
                    persist_candidates=persist_candidates,
                )
                override_applied = applied_conservative_floor
                override_reason = (
                    "deferred_active_snapshot_mixed_default_sessions_conservative_floor"
                    if applied_conservative_floor
                    else "deferred_active_snapshot_mixed_default_sessions"
                )
            else:
                (
                    applied_confident_sample_override,
                    confident_sample_live_usage,
                ) = _apply_deferred_confident_sample_override(
                    account_id=account_id,
                    raw_samples_override=confident_raw_samples_override,
                    primary_usage=primary_usage,
                    secondary_usage=secondary_usage,
                    persist_candidates=persist_candidates,
                )
                if applied_confident_sample_override:
                    override_applied = True
                    override_reason = "deferred_active_snapshot_confident_sample_override"
                    if confident_sample_live_usage is not None:
                        debug_live_usage = confident_sample_live_usage
                else:
                    (
                        applied_sample_floor_override,
                        sample_floor_live_usage,
                    ) = _apply_deferred_sample_floor_override(
                        account_id=account_id,
                        snapshots_considered=snapshots_considered,
                        live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                        primary_usage=primary_usage,
                        secondary_usage=secondary_usage,
                        persist_candidates=persist_candidates,
                    )
                    if applied_sample_floor_override:
                        override_applied = True
                        override_reason = "deferred_active_snapshot_sample_floor_override"
                        if sample_floor_live_usage is not None:
                            debug_live_usage = sample_floor_live_usage
                    else:
                        override_applied = False
                        override_reason = "deferred_active_snapshot_mixed_default_sessions"
            _set_live_quota_debug(
                account_id=account_id,
                snapshots_considered=snapshots_considered,
                live_usage=debug_live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                raw_samples_override=raw_samples_override,
                override_applied=override_applied,
                override_reason=override_reason,
                live_quota_debug_by_account=live_quota_debug_by_account,
            )
            _log_live_quota_debug(
                account=account,
                snapshots_considered=snapshots_considered,
                live_usage=debug_live_usage,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
                live_process_session_count=live_process_session_count,
                override_applied=override_applied,
                override_reason=override_reason,
            )
            continue

        recorded_at = to_utc_naive(live_usage.recorded_at)
        if live_usage.primary is not None:
            override_applied = True
            primary_usage[account_id] = _usage_history_from_live_window(
                account_id=account_id,
                window="primary",
                recorded_at=recorded_at,
                usage_window=live_usage.primary,
            )
            persist_candidates.append(
                LiveUsageOverridePersistCandidate(
                    account_id=account_id,
                    window="primary",
                    used_percent=float(live_usage.primary.used_percent),
                    reset_at=live_usage.primary.reset_at,
                    window_minutes=live_usage.primary.window_minutes,
                    recorded_at=recorded_at,
                )
            )
        if live_usage.secondary is not None:
            override_applied = True
            secondary_usage[account_id] = _usage_history_from_live_window(
                account_id=account_id,
                window="secondary",
                recorded_at=recorded_at,
                usage_window=live_usage.secondary,
            )
            persist_candidates.append(
                LiveUsageOverridePersistCandidate(
                    account_id=account_id,
                    window="secondary",
                    used_percent=float(live_usage.secondary.used_percent),
                    reset_at=live_usage.secondary.reset_at,
                    window_minutes=live_usage.secondary.window_minutes,
                    recorded_at=recorded_at,
                )
            )

        if override_reason is None:
            override_reason = "applied_live_usage_windows" if override_applied else "live_session_without_windows"

        _set_live_quota_debug(
            account_id=account_id,
            snapshots_considered=snapshots_considered,
            live_usage=live_usage,
            live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
            raw_samples_override=raw_samples_override,
            override_applied=override_applied,
            override_reason=override_reason,
            live_quota_debug_by_account=live_quota_debug_by_account,
        )
        _log_live_quota_debug(
            account=account,
            snapshots_considered=snapshots_considered,
            live_usage=live_usage,
            live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
            live_process_session_count=live_process_session_count,
            override_applied=override_applied,
            override_reason=override_reason,
        )

    # When process-level session attribution is unavailable, mixed
    # default-session fingerprint heuristics can still recover per-account
    # attribution during a recent snapshot switch while legacy/default-scope
    # sessions are still active. The explicit env flag remains supported as a
    # manual override.
    if (
        not live_process_session_counts_by_snapshot
        and (
            _default_session_fingerprint_fallback_enabled()
            or has_recent_active_snapshot_process_fallback()
            or _has_mixed_default_scope_sessions(
                snapshot_index=snapshot_index,
                live_usage_by_snapshot=live_usage_by_snapshot,
                live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
            )
        )
    ):
        _apply_local_default_session_fingerprint_overrides(
            accounts=accounts,
            snapshot_index=snapshot_index,
            live_usage_by_snapshot=live_usage_by_snapshot,
            live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
            codex_auth_by_account=codex_auth_by_account,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
            primary_usage=primary_usage,
            secondary_usage=secondary_usage,
            codex_session_counts_by_account=codex_live_session_counts_by_account,
            allow_quota_override=not should_defer_active_snapshot_usage,
        )
    return _coalesce_persist_candidates(persist_candidates)


def _apply_deferred_conservative_floor(
    *,
    account: Account,
    account_id: str,
    live_usage: LocalCodexLiveUsage,
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    persist_candidates: list[LiveUsageOverridePersistCandidate],
) -> bool:
    if account.status != AccountStatus.DEACTIVATED:
        return False

    applied = False
    recorded_at = to_utc_naive(live_usage.recorded_at)

    if live_usage.primary is not None:
        applied = True
        primary_usage[account_id] = _usage_history_from_live_window(
            account_id=account_id,
            window="primary",
            recorded_at=recorded_at,
            usage_window=live_usage.primary,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="primary",
                used_percent=float(live_usage.primary.used_percent),
                reset_at=live_usage.primary.reset_at,
                window_minutes=live_usage.primary.window_minutes,
                recorded_at=recorded_at,
            )
        )

    if live_usage.secondary is not None:
        applied = True
        secondary_usage[account_id] = _usage_history_from_live_window(
            account_id=account_id,
            window="secondary",
            recorded_at=recorded_at,
            usage_window=live_usage.secondary,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="secondary",
                used_percent=float(live_usage.secondary.used_percent),
                reset_at=live_usage.secondary.reset_at,
                window_minutes=live_usage.secondary.window_minutes,
                recorded_at=recorded_at,
            )
        )

    return applied


def _apply_deferred_confident_sample_override(
    *,
    account_id: str,
    raw_samples_override: list[AccountLiveQuotaDebugSample] | None,
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    persist_candidates: list[LiveUsageOverridePersistCandidate],
) -> tuple[bool, LocalCodexLiveUsage | None]:
    if not raw_samples_override:
        return False, None

    selected_sample = next(
        (
            sample
            for sample in raw_samples_override
            if not sample.stale and (sample.primary is not None or sample.secondary is not None)
        ),
        None,
    )
    if selected_sample is None:
        return False, None

    recorded_at = to_utc_naive(selected_sample.recorded_at)
    applied = False

    if selected_sample.primary is not None:
        applied = True
        primary_usage[account_id] = UsageHistory(
            account_id=account_id,
            window="primary",
            used_percent=float(selected_sample.primary.used_percent),
            reset_at=selected_sample.primary.reset_at,
            window_minutes=selected_sample.primary.window_minutes,
            recorded_at=recorded_at,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="primary",
                used_percent=float(selected_sample.primary.used_percent),
                reset_at=selected_sample.primary.reset_at,
                window_minutes=selected_sample.primary.window_minutes,
                recorded_at=recorded_at,
            )
        )

    if selected_sample.secondary is not None:
        applied = True
        secondary_usage[account_id] = UsageHistory(
            account_id=account_id,
            window="secondary",
            used_percent=float(selected_sample.secondary.used_percent),
            reset_at=selected_sample.secondary.reset_at,
            window_minutes=selected_sample.secondary.window_minutes,
            recorded_at=recorded_at,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="secondary",
                used_percent=float(selected_sample.secondary.used_percent),
                reset_at=selected_sample.secondary.reset_at,
                window_minutes=selected_sample.secondary.window_minutes,
                recorded_at=recorded_at,
            )
        )

    if not applied:
        return False, None

    sample_live_usage = LocalCodexLiveUsage(
        recorded_at=selected_sample.recorded_at,
        active_session_count=1,
        primary=(
            LocalUsageWindow(
                used_percent=float(selected_sample.primary.used_percent),
                reset_at=selected_sample.primary.reset_at,
                window_minutes=selected_sample.primary.window_minutes,
            )
            if selected_sample.primary is not None
            else None
        ),
        secondary=(
            LocalUsageWindow(
                used_percent=float(selected_sample.secondary.used_percent),
                reset_at=selected_sample.secondary.reset_at,
                window_minutes=selected_sample.secondary.window_minutes,
            )
            if selected_sample.secondary is not None
            else None
        ),
    )
    return True, sample_live_usage


def _apply_deferred_sample_floor_override(
    *,
    account_id: str,
    snapshots_considered: list[str],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    persist_candidates: list[LiveUsageOverridePersistCandidate],
) -> tuple[bool, LocalCodexLiveUsage | None]:
    candidate_samples: list[LocalCodexLiveUsageSample] = []
    for snapshot_name in snapshots_considered:
        candidate_samples.extend(live_usage_samples_by_snapshot.get(snapshot_name, []))

    if not candidate_samples:
        return False, None

    non_stale_samples = [sample for sample in candidate_samples if not sample.stale]
    usable_samples = non_stale_samples if non_stale_samples else candidate_samples
    primary_samples = [sample for sample in usable_samples if sample.primary is not None]
    secondary_samples = [sample for sample in usable_samples if sample.secondary is not None]

    if not primary_samples and not secondary_samples:
        return False, None

    # When deferred matching cannot safely map reset fingerprints to a
    # single account, prefer the freshest sample for each window. This keeps
    # active-snapshot cards closer to the current CLI banner while avoiding
    # max/min outlier swings from mixed default-session telemetry.
    primary_sample = max(
        primary_samples,
        key=lambda sample: (
            _source_session_start_key(sample.source),
            sample.recorded_at.timestamp(),
            -float(sample.primary.used_percent),
            sample.source,
        ),
        default=None,
    )
    secondary_sample = max(
        secondary_samples,
        key=lambda sample: (
            _source_session_start_key(sample.source),
            sample.recorded_at.timestamp(),
            -float(sample.secondary.used_percent),
            sample.source,
        ),
        default=None,
    )

    applied = False

    if primary_sample is not None:
        primary_window = primary_sample.primary
        assert primary_window is not None
        recorded_at = to_utc_naive(primary_sample.recorded_at)
        primary_usage[account_id] = UsageHistory(
            account_id=account_id,
            window="primary",
            used_percent=float(primary_window.used_percent),
            reset_at=primary_window.reset_at,
            window_minutes=primary_window.window_minutes,
            recorded_at=recorded_at,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="primary",
                used_percent=float(primary_window.used_percent),
                reset_at=primary_window.reset_at,
                window_minutes=primary_window.window_minutes,
                recorded_at=recorded_at,
            )
        )
        applied = True

    if secondary_sample is not None:
        secondary_window = secondary_sample.secondary
        assert secondary_window is not None
        recorded_at = to_utc_naive(secondary_sample.recorded_at)
        secondary_usage[account_id] = UsageHistory(
            account_id=account_id,
            window="secondary",
            used_percent=float(secondary_window.used_percent),
            reset_at=secondary_window.reset_at,
            window_minutes=secondary_window.window_minutes,
            recorded_at=recorded_at,
        )
        persist_candidates.append(
            LiveUsageOverridePersistCandidate(
                account_id=account_id,
                window="secondary",
                used_percent=float(secondary_window.used_percent),
                reset_at=secondary_window.reset_at,
                window_minutes=secondary_window.window_minutes,
                recorded_at=recorded_at,
            )
        )
        applied = True

    if not applied:
        return False, None

    debug_recorded_at = max(
        (
            sample.recorded_at
            for sample in (primary_sample, secondary_sample)
            if sample is not None
        ),
        default=datetime.now(timezone.utc),
    )
    sample_floor_live_usage = LocalCodexLiveUsage(
        recorded_at=debug_recorded_at,
        active_session_count=1,
        primary=(
            LocalUsageWindow(
                used_percent=float(primary_sample.primary.used_percent),
                reset_at=primary_sample.primary.reset_at,
                window_minutes=primary_sample.primary.window_minutes,
            )
            if primary_sample is not None and primary_sample.primary is not None
            else None
        ),
        secondary=(
            LocalUsageWindow(
                used_percent=float(secondary_sample.secondary.used_percent),
                reset_at=secondary_sample.secondary.reset_at,
                window_minutes=secondary_sample.secondary.window_minutes,
            )
            if secondary_sample is not None and secondary_sample.secondary is not None
            else None
        ),
    )
    return True, sample_floor_live_usage


def _coalesce_persist_candidates(
    candidates: list[LiveUsageOverridePersistCandidate],
) -> list[LiveUsageOverridePersistCandidate]:
    latest_by_key: dict[tuple[str, str], LiveUsageOverridePersistCandidate] = {}
    for candidate in candidates:
        key = (candidate.account_id, candidate.window)
        existing = latest_by_key.get(key)
        if existing is None or candidate.recorded_at >= existing.recorded_at:
            latest_by_key[key] = candidate
    return list(latest_by_key.values())


def _source_session_start_key(source: str) -> str:
    match = _ROLLOUT_SOURCE_SESSION_PREFIX_RE.search(Path(source).name)
    if match is None:
        return ""
    return match.group(1)


def _resolve_snapshot_candidates(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
) -> list[str]:
    candidate_names = [name for name in [selected_snapshot_name, *snapshot_names] if name]
    seen: set[str] = set()
    ordered: list[str] = []
    for snapshot_name in candidate_names:
        if snapshot_name in seen:
            continue
        seen.add(snapshot_name)
        ordered.append(snapshot_name)
    return ordered


def _set_live_quota_debug(
    *,
    account_id: str,
    snapshots_considered: list[str],
    live_usage: LocalCodexLiveUsage | None,
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
    raw_samples_override: list[AccountLiveQuotaDebugSample] | None = None,
    override_applied: bool,
    override_reason: str | None,
    live_quota_debug_by_account: dict[str, AccountLiveQuotaDebug] | None,
) -> None:
    if live_quota_debug_by_account is None:
        return

    if raw_samples_override is not None:
        raw_samples = sorted(
            raw_samples_override,
            key=lambda sample: sample.recorded_at,
            reverse=True,
        )
    else:
        raw_samples = _resolve_debug_raw_samples(
            snapshots_considered=snapshots_considered,
            live_usage_samples_by_snapshot=live_usage_samples_by_snapshot,
        )
    merged = _build_debug_sample(
        source="merged",
        snapshot_name=snapshots_considered[0] if snapshots_considered else None,
        recorded_at=live_usage.recorded_at if live_usage is not None else None,
        primary=live_usage.primary if live_usage is not None else None,
        secondary=live_usage.secondary if live_usage is not None else None,
        stale=False,
    )
    live_quota_debug_by_account[account_id] = AccountLiveQuotaDebug(
        snapshots_considered=snapshots_considered,
        raw_samples=raw_samples,
        merged=merged,
        override_applied=override_applied,
        override_reason=override_reason,
    )


def _resolve_debug_raw_samples(
    *,
    snapshots_considered: list[str],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
) -> list[AccountLiveQuotaDebugSample]:
    raw_samples: list[AccountLiveQuotaDebugSample] = []
    for snapshot_name in snapshots_considered:
        for sample in live_usage_samples_by_snapshot.get(snapshot_name, []):
            debug_sample = _build_debug_sample(
                source=sample.source,
                snapshot_name=snapshot_name,
                recorded_at=sample.recorded_at,
                primary=sample.primary,
                secondary=sample.secondary,
                stale=sample.stale,
            )
            if debug_sample is not None:
                raw_samples.append(debug_sample)
    raw_samples.sort(key=lambda sample: sample.recorded_at, reverse=True)
    return raw_samples


def _has_fresh_quota_sample_for_account(
    *,
    snapshots_considered: list[str],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
    raw_samples_override: list[AccountLiveQuotaDebugSample] | None,
) -> bool:
    if raw_samples_override is not None:
        return any(
            not sample.stale and (sample.primary is not None or sample.secondary is not None)
            for sample in raw_samples_override
        )

    for snapshot_name in snapshots_considered:
        for sample in live_usage_samples_by_snapshot.get(snapshot_name, []):
            if sample.stale:
                continue
            if sample.primary is None and sample.secondary is None:
                continue
            return True
    return False


def _build_default_sample_debug_overrides(
    *,
    accounts: list[Account],
    snapshot_index: CodexAuthSnapshotIndex,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
    should_defer_active_snapshot_usage: bool,
) -> tuple[
    dict[str, list[AccountLiveQuotaDebugSample]],
    dict[str, list[AccountLiveQuotaDebugSample]],
]:
    if not should_defer_active_snapshot_usage:
        return {}, {}

    active_snapshot_name = snapshot_index.active_snapshot_name
    if not active_snapshot_name:
        return {}, {}

    default_scope_samples = list(live_usage_samples_by_snapshot.get(active_snapshot_name, []))
    if not default_scope_samples:
        return {}, {}

    candidate_accounts = [
        account
        for account in accounts
        if _account_has_snapshot(codex_auth_by_account.get(account.id))
    ]
    if len(candidate_accounts) <= 1:
        return {}, {}

    active_account_id = _resolve_active_snapshot_account_id(
        accounts=accounts,
        codex_auth_by_account=codex_auth_by_account,
        active_snapshot_name=active_snapshot_name,
    )

    assignment_samples = [
        LocalCodexLiveUsage(
            recorded_at=sample.recorded_at,
            active_session_count=1,
            primary=sample.primary,
            secondary=sample.secondary,
        )
        for sample in default_scope_samples
    ]
    assignments = _resolve_sample_account_assignments(
        samples=assignment_samples,
        accounts=candidate_accounts,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
        sample_sources=[sample.source for sample in default_scope_samples],
        preferred_account_id=active_account_id,
    )
    if not assignments:
        return {}, {}

    debug_samples_by_account: dict[str, list[AccountLiveQuotaDebugSample]] = {}
    confident_samples_by_account: dict[str, list[AccountLiveQuotaDebugSample]] = {}
    for sample_index, match in assignments.items():
        include_for_debug = match.confidence == "high" or (
            active_account_id is not None and match.account_id == active_account_id
        )
        if not include_for_debug:
            continue
        if sample_index < 0 or sample_index >= len(default_scope_samples):
            continue
        sample = default_scope_samples[sample_index]
        match_status = codex_auth_by_account.get(match.account_id)
        snapshot_name = match_status.snapshot_name if match_status is not None else active_snapshot_name
        debug_sample = _build_debug_sample(
            source=sample.source,
            snapshot_name=snapshot_name,
            recorded_at=sample.recorded_at,
            primary=sample.primary,
            secondary=sample.secondary,
            stale=sample.stale,
        )
        if debug_sample is None:
            continue
        debug_samples_by_account.setdefault(match.account_id, []).append(debug_sample)
        if match.allows_quota_override:
            confident_samples_by_account.setdefault(match.account_id, []).append(debug_sample)
        if match.confidence == "high":
            _remember_sample_source_owner(
                source=sample.source,
                account_id=match.account_id,
                observed_at=sample.recorded_at,
            )

    for samples in debug_samples_by_account.values():
        samples.sort(key=lambda sample: sample.recorded_at, reverse=True)
    for samples in confident_samples_by_account.values():
        samples.sort(key=lambda sample: sample.recorded_at, reverse=True)

    return debug_samples_by_account, confident_samples_by_account


def _build_debug_sample(
    *,
    source: str,
    snapshot_name: str | None,
    recorded_at: datetime | None,
    primary: LocalUsageWindow | None,
    secondary: LocalUsageWindow | None,
    stale: bool,
) -> AccountLiveQuotaDebugSample | None:
    if recorded_at is None:
        return None
    if primary is None and secondary is None:
        # Presence-only sample snapshots are useful for internal session
        # counting, but they add noisy "$ sample ... 5h=— weekly=—" rows in
        # UI debug logs and should not be exposed as quota telemetry.
        return None
    return AccountLiveQuotaDebugSample(
        source=source,
        snapshot_name=snapshot_name,
        recorded_at=recorded_at,
        stale=stale,
        primary=_build_debug_window(primary),
        secondary=_build_debug_window(secondary),
    )


def _build_debug_window(window: LocalUsageWindow | None) -> AccountLiveQuotaDebugWindow | None:
    if window is None:
        return None
    used_percent = float(window.used_percent)
    remaining_percent = max(0.0, min(100.0, 100.0 - used_percent))
    return AccountLiveQuotaDebugWindow(
        used_percent=used_percent,
        remaining_percent=remaining_percent,
        reset_at=window.reset_at,
        window_minutes=window.window_minutes,
    )


def _live_usage_debug_enabled() -> bool:
    raw = (os.environ.get(_LIVE_USAGE_DEBUG_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _default_session_fingerprint_fallback_enabled() -> bool:
    raw = (os.environ.get(_DEFAULT_SESSION_FINGERPRINT_FALLBACK_ENV) or "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _log_live_quota_debug(
    *,
    account: Account,
    snapshots_considered: list[str],
    live_usage: LocalCodexLiveUsage | None,
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
    live_process_session_count: int,
    override_applied: bool,
    override_reason: str | None,
) -> None:
    if not _live_usage_debug_enabled():
        return

    raw_summary: list[str] = []
    for snapshot_name in snapshots_considered:
        for sample in live_usage_samples_by_snapshot.get(snapshot_name, []):
            primary = f"{sample.primary.used_percent:.1f}" if sample.primary is not None else "-"
            secondary = f"{sample.secondary.used_percent:.1f}" if sample.secondary is not None else "-"
            raw_summary.append(
                f"{snapshot_name}:{sample.source}:5h={primary}%:7d={secondary}%:stale={sample.stale}"
            )

    merged_primary = f"{live_usage.primary.used_percent:.1f}" if live_usage and live_usage.primary else "-"
    merged_secondary = f"{live_usage.secondary.used_percent:.1f}" if live_usage and live_usage.secondary else "-"
    logger.info(
        "live_quota_debug account_id=%s email=%s snapshots=%s process_sessions=%s merged_5h=%s merged_7d=%s applied=%s reason=%s raw=%s",
        account.id,
        account.email,
        snapshots_considered,
        live_process_session_count,
        merged_primary,
        merged_secondary,
        override_applied,
        override_reason,
        raw_summary,
    )


def _resolve_live_usage_for_account(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
) -> LocalCodexLiveUsage | None:
    candidate_names = _resolve_snapshot_candidates(
        snapshot_names=snapshot_names,
        selected_snapshot_name=selected_snapshot_name,
    )
    merged: LocalCodexLiveUsage | None = None
    for snapshot_name in candidate_names:
        usage = live_usage_by_snapshot.get(snapshot_name)
        if usage is None:
            continue
        merged = _merge_live_usage(merged, usage)
    return merged


def _resolve_live_process_session_count_for_account(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
    live_process_session_counts_by_snapshot: dict[str, int],
) -> int:
    candidate_names = _resolve_snapshot_candidates(
        snapshot_names=snapshot_names,
        selected_snapshot_name=selected_snapshot_name,
    )
    total = 0
    for snapshot_name in candidate_names:
        total += max(0, live_process_session_counts_by_snapshot.get(snapshot_name, 0))
    return total


def _resolve_live_runtime_session_count_for_account(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
    runtime_live_session_counts_by_snapshot: dict[str, int],
) -> int:
    candidate_names = _resolve_snapshot_candidates(
        snapshot_names=snapshot_names,
        selected_snapshot_name=selected_snapshot_name,
    )
    total = 0
    for snapshot_name in candidate_names:
        total += max(0, runtime_live_session_counts_by_snapshot.get(snapshot_name, 0))
    return total


def _merge_live_usage(previous: LocalCodexLiveUsage | None, current: LocalCodexLiveUsage) -> LocalCodexLiveUsage:
    if previous is None:
        return current

    prefer_current = current.recorded_at >= previous.recorded_at
    preferred = current if prefer_current else previous
    fallback = previous if prefer_current else current

    return LocalCodexLiveUsage(
        recorded_at=max(previous.recorded_at, current.recorded_at),
        active_session_count=max(0, previous.active_session_count) + max(0, current.active_session_count),
        primary=preferred.primary if preferred.primary is not None else fallback.primary,
        secondary=preferred.secondary if preferred.secondary is not None else fallback.secondary,
    )


def _usage_history_from_live_window(
    *,
    account_id: str,
    window: str,
    recorded_at: datetime,
    usage_window: LocalUsageWindow,
) -> UsageHistory:
    return UsageHistory(
        account_id=account_id,
        window=window,
        used_percent=float(usage_window.used_percent),
        reset_at=usage_window.reset_at,
        window_minutes=usage_window.window_minutes,
        recorded_at=recorded_at,
    )


def _apply_local_default_session_fingerprint_overrides(
    *,
    accounts: list[Account],
    snapshot_index: CodexAuthSnapshotIndex,
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]] | None = None,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    codex_session_counts_by_account: dict[str, int],
    allow_quota_override: bool = True,
) -> None:
    active_snapshot_name = snapshot_index.active_snapshot_name
    if not active_snapshot_name:
        return
    active_snapshot_live_usage = live_usage_by_snapshot.get(active_snapshot_name)
    if active_snapshot_live_usage is None:
        return
    if len(live_usage_by_snapshot) != 1 or active_snapshot_live_usage.active_session_count <= 1:
        return

    default_scope_samples = list((live_usage_samples_by_snapshot or {}).get(active_snapshot_name, []))
    if len(default_scope_samples) <= 1:
        return

    candidate_accounts = [
        account
        for account in accounts
        if _account_has_snapshot(codex_auth_by_account.get(account.id))
    ]
    if len(candidate_accounts) <= 1:
        return

    active_account_id = _resolve_active_snapshot_account_id(
        accounts=accounts,
        codex_auth_by_account=codex_auth_by_account,
        active_snapshot_name=active_snapshot_name,
    )
    samples = [
        LocalCodexLiveUsage(
            recorded_at=sample.recorded_at,
            active_session_count=1,
            primary=sample.primary,
            secondary=sample.secondary,
        )
        for sample in default_scope_samples
    ]
    sample_sources = [sample.source for sample in default_scope_samples]
    sample_matches_by_index = _resolve_sample_account_assignments(
        samples=samples,
        accounts=candidate_accounts,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
        sample_sources=sample_sources,
        preferred_account_id=active_account_id,
    )
    if not sample_matches_by_index:
        return

    matched_counts_by_account: dict[str, int] = {}
    latest_attribution_by_account: dict[str, _SampleAttribution] = {}
    for sample_index, match in sample_matches_by_index.items():
        sample = samples[sample_index]
        source = sample_sources[sample_index]
        if match.confidence == "high":
            _remember_sample_source_owner(
                source=source,
                account_id=match.account_id,
                observed_at=sample.recorded_at,
            )
        account_id = match.account_id
        matched_counts_by_account[account_id] = matched_counts_by_account.get(account_id, 0) + 1
        previous_attribution = latest_attribution_by_account.get(account_id)
        if (
            previous_attribution is None
            or sample.recorded_at > previous_attribution.sample.recorded_at
            or (
                sample.recorded_at == previous_attribution.sample.recorded_at
                and match.allows_quota_override
                and not previous_attribution.match.allows_quota_override
            )
        ):
            latest_attribution_by_account[account_id] = _SampleAttribution(
                sample=sample,
                match=match,
            )

    for account in accounts:
        account_id = account.id
        match_count = matched_counts_by_account.get(account_id)
        if not match_count:
            continue

        codex_auth_status = codex_auth_by_account.get(account_id)
        if codex_auth_status is not None:
            codex_auth_status.has_live_session = True
            latest_attribution = latest_attribution_by_account.get(account_id)
            codex_auth_status.live_usage_confidence = (
                latest_attribution.match.confidence if latest_attribution is not None else None
            )

        codex_session_counts_by_account[account_id] = max(
            codex_session_counts_by_account.get(account_id, 0),
            match_count,
        )

        latest_attribution = latest_attribution_by_account.get(account_id)
        if latest_attribution is None:
            continue

        if not allow_quota_override or not latest_attribution.match.allows_quota_override:
            # Ambiguous or presence-only attribution still contributes to
            # live/session recall, but quota windows remain conservative.
            continue

        latest_sample = latest_attribution.sample
        recorded_at = to_utc_naive(latest_sample.recorded_at)
        if latest_sample.primary is not None:
            primary_usage[account_id] = _usage_history_from_live_window(
                account_id=account_id,
                window="primary",
                recorded_at=recorded_at,
                usage_window=latest_sample.primary,
            )
        if latest_sample.secondary is not None:
            secondary_usage[account_id] = _usage_history_from_live_window(
                account_id=account_id,
                window="secondary",
                recorded_at=recorded_at,
                usage_window=latest_sample.secondary,
            )


def _account_has_snapshot(status: AccountCodexAuthStatus | None) -> bool:
    return bool(status and status.has_snapshot)


def _should_defer_active_snapshot_usage_override(
    *,
    accounts: list[Account],
    snapshot_index: CodexAuthSnapshotIndex,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
) -> bool:
    active_snapshot_name = snapshot_index.active_snapshot_name
    if not active_snapshot_name:
        return False

    active_snapshot_live_usage = live_usage_by_snapshot.get(active_snapshot_name)
    if active_snapshot_live_usage is None:
        return False

    if len(live_usage_by_snapshot) != 1 or active_snapshot_live_usage.active_session_count <= 1:
        return False

    accounts_with_snapshot = sum(
        1
        for account in accounts
        if _account_has_snapshot(codex_auth_by_account.get(account.id))
    )
    return accounts_with_snapshot > 1


def _sample_has_fingerprint(sample: LocalCodexLiveUsage) -> bool:
    return sample.primary is not None or sample.secondary is not None


def _has_mixed_default_scope_sessions(
    *,
    snapshot_index: CodexAuthSnapshotIndex,
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
    live_usage_samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]],
) -> bool:
    active_snapshot_name = snapshot_index.active_snapshot_name
    if not active_snapshot_name:
        return False
    active_usage = live_usage_by_snapshot.get(active_snapshot_name)
    if active_usage is None:
        return False
    if len(live_usage_by_snapshot) != 1 or active_usage.active_session_count <= 1:
        return False
    return len(live_usage_samples_by_snapshot.get(active_snapshot_name, [])) > 1


def _remember_snapshot_sample_owners_for_account(
    *,
    account_id: str,
    samples: list[LocalCodexLiveUsageSample],
) -> None:
    for sample in samples:
        if sample.primary is None and sample.secondary is None:
            continue
        _remember_sample_source_owner(
            source=sample.source,
            account_id=account_id,
            observed_at=sample.recorded_at,
        )


def _remember_sample_source_owner(
    *,
    source: str,
    account_id: str,
    observed_at: datetime,
) -> None:
    if not source:
        return
    normalized_observed_at = _normalize_observed_at(observed_at)
    existing = _sample_source_owner_cache.get(source)
    if existing is not None and existing.observed_at > normalized_observed_at:
        return
    _sample_source_owner_cache[source] = _SampleSourceOwner(
        account_id=account_id,
        observed_at=normalized_observed_at,
    )
    _prune_sample_source_owner_cache(normalized_observed_at)


def _lookup_sample_source_owner(
    *,
    source: str,
    allowed_account_ids: list[str],
) -> str | None:
    if not source:
        return None
    owner = _sample_source_owner_cache.get(source)
    if owner is None:
        return None

    now = datetime.now(timezone.utc)
    if _normalize_observed_at(owner.observed_at) < _normalize_observed_at(now) - _SAMPLE_SOURCE_OWNER_TTL:
        _sample_source_owner_cache.pop(source, None)
        return None
    if owner.account_id not in allowed_account_ids:
        return None
    return owner.account_id


def _prune_sample_source_owner_cache(now: datetime) -> None:
    cutoff = _normalize_observed_at(now) - _SAMPLE_SOURCE_OWNER_TTL
    stale_keys = [
        key
        for key, value in _sample_source_owner_cache.items()
        if _normalize_observed_at(value.observed_at) < cutoff
    ]
    for key in stale_keys:
        _sample_source_owner_cache.pop(key, None)

    if len(_sample_source_owner_cache) <= _SAMPLE_SOURCE_OWNER_MAX_ENTRIES:
        return
    ordered = sorted(
        _sample_source_owner_cache.items(),
        key=lambda item: _normalize_observed_at(item[1].observed_at),
        reverse=True,
    )
    _sample_source_owner_cache.clear()
    _sample_source_owner_cache.update(ordered[:_SAMPLE_SOURCE_OWNER_MAX_ENTRIES])


def _normalize_observed_at(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=timezone.utc)


def _resolve_active_snapshot_account_id(
    *,
    accounts: list[Account],
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    active_snapshot_name: str,
) -> str | None:
    for account in accounts:
        status = codex_auth_by_account.get(account.id)
        if status is None:
            continue
        if status.snapshot_name == active_snapshot_name:
            return account.id

    for account in accounts:
        status = codex_auth_by_account.get(account.id)
        if status is None:
            continue
        if status.is_active_snapshot:
            return account.id
    return None


def _match_sample_to_account(
    *,
    sample: LocalCodexLiveUsage,
    accounts: list[Account],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> _SampleMatchResult | None:
    unique_account_id = _resolve_unique_reset_match_account_id(
        sample=sample,
        accounts=accounts,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
    )
    if unique_account_id is not None:
        return _SampleMatchResult(
            account_id=unique_account_id,
            confidence="high",
            allows_quota_override=True,
        )

    best_match: tuple[float, float, str, _SampleMatchResult] | None = None
    for account in sorted(accounts, key=lambda item: item.id):
        match_metrics = _build_sample_match_metrics(
            sample=sample,
            account_id=account.id,
            accounts=accounts,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
        )
        if match_metrics is None:
            continue
        distance, margin, confidence = match_metrics
        candidate = (
            distance,
            -margin,
            account.id,
            _SampleMatchResult(
                account_id=account.id,
                confidence=confidence,
                allows_quota_override=False,
            ),
        )
        if best_match is None or candidate < best_match:
            best_match = candidate

    if best_match is None:
        return None
    return best_match[3]


def _resolve_sample_account_assignments(
    *,
    samples: list[LocalCodexLiveUsage],
    accounts: list[Account],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
    sample_sources: list[str] | None = None,
    preferred_account_id: str | None = None,
) -> dict[int, _SampleMatchResult]:
    assignments: dict[int, _SampleMatchResult] = {}
    if not samples or not accounts:
        return assignments

    sorted_accounts = sorted(accounts, key=lambda account: account.id)
    account_ids = [account.id for account in sorted_accounts]
    assigned_counts: dict[str, int] = {account_id: 0 for account_id in account_ids}
    unresolved_sample_indexes = set(range(len(samples)))

    # Pass 1: preserve previously observed per-source ownership.
    if sample_sources is not None:
        for sample_index in _sorted_sample_indexes(samples, unresolved_sample_indexes):
            if sample_index < 0 or sample_index >= len(sample_sources):
                continue
            source = sample_sources[sample_index]
            cached_account_id = _lookup_sample_source_owner(
                source=source,
                allowed_account_ids=account_ids,
            )
            if cached_account_id is None:
                continue
            assignments[sample_index] = _SampleMatchResult(
                account_id=cached_account_id,
                confidence="high",
                allows_quota_override=False,
            )
            assigned_counts[cached_account_id] += 1
            unresolved_sample_indexes.remove(sample_index)

    # Pass 2: hard anchors from unique reset fingerprint matches.
    for sample_index in _sorted_sample_indexes(samples, unresolved_sample_indexes):
        sample = samples[sample_index]
        unique_account_id = _resolve_unique_reset_match_account_id(
            sample=sample,
            accounts=sorted_accounts,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
        )
        if unique_account_id is None:
            continue
        assignments[sample_index] = _SampleMatchResult(
            account_id=unique_account_id,
            confidence="high",
            allows_quota_override=True,
        )
        assigned_counts[unique_account_id] += 1
        unresolved_sample_indexes.remove(sample_index)

    # Pass 3: deterministic cost-based assignment for remaining fingerprint samples.
    #
    # Only keep high-confidence matches here. Low-confidence matches are left
    # unresolved so Pass 4 can conservatively pin them to the preferred
    # account (typically the active snapshot) instead of spreading ambiguous
    # samples across unrelated accounts.
    for sample_index in _sorted_sample_indexes(samples, unresolved_sample_indexes):
        sample = samples[sample_index]
        if not _sample_has_fingerprint(sample):
            continue

        best_match: tuple[float, float, str, _SampleMatchResult] | None = None
        for account_id in account_ids:
            match_metrics = _build_sample_match_metrics(
                sample=sample,
                account_id=account_id,
                accounts=sorted_accounts,
                baseline_primary_usage=baseline_primary_usage,
                baseline_secondary_usage=baseline_secondary_usage,
            )
            if match_metrics is None:
                continue
            distance, margin, confidence = match_metrics
            candidate = (
                distance,
                -margin,
                account_id,
                _SampleMatchResult(
                    account_id=account_id,
                    confidence=confidence,
                    allows_quota_override=False,
                ),
            )
            if best_match is None or candidate < best_match:
                best_match = candidate

        if best_match is None:
            continue

        _, _, account_id, match = best_match
        if match.confidence != "high":
            continue
        assignments[sample_index] = match
        assigned_counts[account_id] += 1
        unresolved_sample_indexes.remove(sample_index)

    # Pass 4: conservative fallback for unresolved samples.
    for sample_index in _sorted_sample_indexes(samples, unresolved_sample_indexes):
        account_id = preferred_account_id if preferred_account_id in assigned_counts else None
        if account_id is None:
            account_id = min(
                account_ids,
                key=lambda item: (assigned_counts[item], item),
            )
        assignments[sample_index] = _SampleMatchResult(
            account_id=account_id,
            confidence="low",
            allows_quota_override=False,
        )
        assigned_counts[account_id] += 1

    return assignments


def _build_sample_match_metrics(
    *,
    sample: LocalCodexLiveUsage,
    account_id: str,
    accounts: list[Account],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> tuple[float, float, Literal["high", "low"]] | None:
    distance = _sample_percent_distance_for_account(
        sample=sample,
        account_id=account_id,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
    )
    if distance is None:
        return None

    runner_up_distance: float | None = None
    for account in sorted(accounts, key=lambda item: item.id):
        if account.id == account_id:
            continue
        candidate_distance = _sample_percent_distance_for_account(
            sample=sample,
            account_id=account.id,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
        )
        if candidate_distance is None:
            continue
        if runner_up_distance is None or candidate_distance < runner_up_distance:
            runner_up_distance = candidate_distance

    margin = (runner_up_distance - distance) if runner_up_distance is not None else float("inf")
    confidence: Literal["high", "low"] = "high"
    if not (
        distance <= _PERCENT_PATTERN_HIGH_CONFIDENCE_MAX_DISTANCE
        and (
            runner_up_distance is None
            or margin >= _PERCENT_PATTERN_HIGH_CONFIDENCE_MARGIN
        )
    ):
        confidence = "low"

    return distance, margin, confidence


def _sorted_sample_indexes(samples: list[LocalCodexLiveUsage], indexes: set[int]) -> list[int]:
    def _sort_key(sample_index: int) -> tuple[float, float, float, float, float, int]:
        sample = samples[sample_index]
        return (
            -sample.recorded_at.timestamp(),
            sample.primary.used_percent if sample.primary is not None else float("inf"),
            sample.secondary.used_percent if sample.secondary is not None else float("inf"),
            (
                float(sample.primary.reset_at)
                if sample.primary is not None and sample.primary.reset_at is not None
                else float("inf")
            ),
            (
                float(sample.secondary.reset_at)
                if sample.secondary is not None and sample.secondary.reset_at is not None
                else float("inf")
            ),
            sample_index,
        )

    return sorted(indexes, key=_sort_key)


def _sample_percent_distance_for_account(
    *,
    sample: LocalCodexLiveUsage,
    account_id: str,
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> float | None:
    sample_primary_used = sample.primary.used_percent if sample.primary is not None else None
    sample_secondary_used = sample.secondary.used_percent if sample.secondary is not None else None

    account_primary_usage = baseline_primary_usage.get(account_id)
    account_secondary_usage = baseline_secondary_usage.get(account_id)
    account_primary_used = account_primary_usage.used_percent if account_primary_usage is not None else None
    account_secondary_used = account_secondary_usage.used_percent if account_secondary_usage is not None else None

    deltas: list[float] = []
    if sample_primary_used is not None and account_primary_used is not None:
        deltas.append(abs(sample_primary_used - account_primary_used))
    if sample_secondary_used is not None and account_secondary_used is not None:
        deltas.append(abs(sample_secondary_used - account_secondary_used))

    if not deltas:
        return None
    return sum(deltas) / float(len(deltas))


def _resolve_unique_reset_match_account_id(
    *,
    sample: LocalCodexLiveUsage,
    accounts: list[Account],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> str | None:
    primary_reset = sample.primary.reset_at if sample.primary is not None else None
    secondary_reset = sample.secondary.reset_at if sample.secondary is not None else None

    def _match_accounts_for_reset(*, window: Literal["primary", "secondary"], reset_at: int) -> set[str]:
        matches: set[str] = set()
        for account in accounts:
            usage_entry = (
                baseline_primary_usage.get(account.id)
                if window == "primary"
                else baseline_secondary_usage.get(account.id)
            )
            usage_reset_at = usage_entry.reset_at if usage_entry is not None else None
            if usage_reset_at is None:
                continue
            if abs(reset_at - usage_reset_at) <= _RESET_FINGERPRINT_MATCH_TOLERANCE_SECONDS:
                matches.add(account.id)
        return matches

    primary_unique: str | None = None
    if primary_reset is not None:
        primary_matches = _match_accounts_for_reset(window="primary", reset_at=primary_reset)
        if len(primary_matches) == 1:
            primary_unique = next(iter(primary_matches))

    secondary_unique: str | None = None
    if secondary_reset is not None:
        secondary_matches = _match_accounts_for_reset(window="secondary", reset_at=secondary_reset)
        if len(secondary_matches) == 1:
            secondary_unique = next(iter(secondary_matches))

    if primary_unique and secondary_unique:
        if primary_unique == secondary_unique:
            return primary_unique
        return None

    return primary_unique or secondary_unique
