from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.core.utils.time import to_utc_naive
from app.db.models import Account, UsageHistory
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalUsageWindow,
    read_local_codex_live_usage_by_snapshot,
    read_local_codex_live_usage_samples,
)
from app.modules.accounts.schemas import AccountCodexAuthStatus


@dataclass(frozen=True)
class LiveUsageOverridePersistCandidate:
    account_id: str
    window: Literal["primary", "secondary"]
    used_percent: float
    reset_at: int | None
    window_minutes: int | None
    recorded_at: datetime

_RESET_FINGERPRINT_TIE_BREAK_SECONDS = 300


def apply_local_live_usage_overrides(
    *,
    accounts: list[Account],
    snapshot_index: CodexAuthSnapshotIndex,
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    codex_session_counts_by_account: dict[str, int],
) -> list[LiveUsageOverridePersistCandidate]:
    baseline_primary_usage = dict(primary_usage)
    baseline_secondary_usage = dict(secondary_usage)
    persist_candidates: list[LiveUsageOverridePersistCandidate] = []
    live_usage_by_snapshot = read_local_codex_live_usage_by_snapshot()
    should_defer_active_snapshot_usage = _should_defer_active_snapshot_usage_override(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        live_usage_by_snapshot=live_usage_by_snapshot,
    )

    for account in accounts:
        codex_auth_status = codex_auth_by_account.get(account.id)
        if codex_auth_status is None:
            continue

        snapshot_names = snapshot_index.snapshots_by_account_id.get(account.id, [])
        live_usage = _resolve_live_usage_for_account(
            snapshot_names=snapshot_names,
            selected_snapshot_name=codex_auth_status.snapshot_name,
            live_usage_by_snapshot=live_usage_by_snapshot,
        )
        has_live_telemetry = bool(live_usage and live_usage.active_session_count > 0)
        codex_auth_status.has_live_session = has_live_telemetry
        if not has_live_telemetry or live_usage is None:
            continue

        account_id = account.id
        codex_session_counts_by_account[account_id] = max(0, live_usage.active_session_count)

        if should_defer_active_snapshot_usage and codex_auth_status.is_active_snapshot:
            # The default sessions directory can include active sessions from
            # multiple snapshots. When that mixed telemetry cannot be reliably
            # split yet, keep quota windows on their baseline account values
            # instead of attributing another snapshot's limits to the active
            # account. We still expose session presence/count immediately.
            continue

        recorded_at = to_utc_naive(live_usage.recorded_at)
        if live_usage.primary is not None:
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

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot=live_usage_by_snapshot,
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary_usage,
        baseline_secondary_usage=baseline_secondary_usage,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )
    return _coalesce_persist_candidates(persist_candidates)


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


def _resolve_live_usage_for_account(
    *,
    snapshot_names: list[str],
    selected_snapshot_name: str | None,
    live_usage_by_snapshot: dict[str, LocalCodexLiveUsage],
) -> LocalCodexLiveUsage | None:
    candidate_names = [name for name in [selected_snapshot_name, *snapshot_names] if name]
    merged: LocalCodexLiveUsage | None = None
    seen: set[str] = set()
    for snapshot_name in candidate_names:
        if snapshot_name in seen:
            continue
        seen.add(snapshot_name)
        usage = live_usage_by_snapshot.get(snapshot_name)
        if usage is None:
            continue
        merged = _merge_live_usage(merged, usage)
    return merged


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
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
    primary_usage: dict[str, UsageHistory],
    secondary_usage: dict[str, UsageHistory],
    codex_session_counts_by_account: dict[str, int],
) -> None:
    active_snapshot_name = snapshot_index.active_snapshot_name
    if not active_snapshot_name:
        return
    active_snapshot_live_usage = live_usage_by_snapshot.get(active_snapshot_name)
    if active_snapshot_live_usage is None:
        return
    if len(live_usage_by_snapshot) != 1 or active_snapshot_live_usage.active_session_count <= 1:
        return

    samples = read_local_codex_live_usage_samples()
    if len(samples) <= 1:
        return
    fingerprint_samples = [sample for sample in samples if _sample_has_fingerprint(sample)]
    if len(fingerprint_samples) <= 1:
        return

    candidate_accounts = [
        account
        for account in accounts
        if _account_has_snapshot(codex_auth_by_account.get(account.id))
        and _account_has_usage_fingerprint(
            account_id=account.id,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
        )
    ]
    if len(candidate_accounts) <= 1:
        return

    active_account_id = _resolve_active_account_id(codex_auth_by_account)

    matched_counts_by_account: dict[str, int] = {}
    for sample in fingerprint_samples:
        account_id = _match_sample_to_account(
            sample=sample,
            accounts=candidate_accounts,
            baseline_primary_usage=baseline_primary_usage,
            baseline_secondary_usage=baseline_secondary_usage,
        )
        if account_id is None:
            continue
        matched_counts_by_account[account_id] = matched_counts_by_account.get(account_id, 0) + 1

    if len(matched_counts_by_account) <= 1:
        if len(matched_counts_by_account) != 1:
            return
        if active_account_id is None:
            return
        only_account_id = next(iter(matched_counts_by_account))
        matched_sample_count = matched_counts_by_account[only_account_id]
        if only_account_id != active_account_id or matched_sample_count != len(fingerprint_samples):
            return

    for account in accounts:
        account_id = account.id
        match_count = matched_counts_by_account.get(account_id)
        if not match_count:
            continue

        codex_auth_status = codex_auth_by_account.get(account_id)
        if codex_auth_status is not None:
            codex_auth_status.has_live_session = True

        codex_session_counts_by_account[account_id] = match_count

        # NOTE:
        # These fallback matches are inferred from local rollout samples when
        # Codex is running only against the default auth pointer. They are good
        # enough to infer "working now" and session counts, but not reliable
        # enough to overwrite per-account quota percentages without causing
        # occasional cross-account bleed (showing one account's budget on
        # another card). Keep baseline quota windows intact here.


def _account_has_snapshot(status: AccountCodexAuthStatus | None) -> bool:
    return bool(status and status.has_snapshot)


def _resolve_active_account_id(
    codex_auth_by_account: dict[str, AccountCodexAuthStatus],
) -> str | None:
    for account_id, status in codex_auth_by_account.items():
        if status.is_active_snapshot:
            return account_id
    return None


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


def _account_has_usage_fingerprint(
    *,
    account_id: str,
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> bool:
    primary_entry = baseline_primary_usage.get(account_id)
    secondary_entry = baseline_secondary_usage.get(account_id)
    if primary_entry is not None:
        if primary_entry.reset_at is not None:
            return True
        if primary_entry.used_percent is not None:
            return True
    if secondary_entry is not None:
        if secondary_entry.reset_at is not None:
            return True
        if secondary_entry.used_percent is not None:
            return True
    return False


def _sample_has_fingerprint(sample: LocalCodexLiveUsage) -> bool:
    primary_reset = sample.primary.reset_at if sample.primary is not None else None
    secondary_reset = sample.secondary.reset_at if sample.secondary is not None else None
    return (
        primary_reset is not None
        or secondary_reset is not None
        or sample.primary is not None
        or sample.secondary is not None
    )


@dataclass(frozen=True)
class _SampleMatchMetrics:
    total_pairs: int
    percent_pairs: int
    reset_pairs: int
    percent_score: float
    reset_score: int


def _match_sample_to_account(
    *,
    sample: LocalCodexLiveUsage,
    accounts: list[Account],
    baseline_primary_usage: dict[str, UsageHistory],
    baseline_secondary_usage: dict[str, UsageHistory],
) -> str | None:
    sample_primary_used = sample.primary.used_percent if sample.primary is not None else None
    sample_secondary_used = sample.secondary.used_percent if sample.secondary is not None else None
    primary_reset = sample.primary.reset_at if sample.primary is not None else None
    secondary_reset = sample.secondary.reset_at if sample.secondary is not None else None
    if (
        sample_primary_used is None
        and sample_secondary_used is None
        and primary_reset is None
        and secondary_reset is None
    ):
        return None

    best_account_id: str | None = None
    best_metrics: _SampleMatchMetrics | None = None
    best_key: tuple[float, float, float, float, float] | None = None
    second_metrics: _SampleMatchMetrics | None = None
    for account in accounts:
        account_id = account.id
        account_primary = baseline_primary_usage.get(account_id)
        account_secondary = baseline_secondary_usage.get(account_id)

        total_pairs = 0
        percent_pairs = 0
        reset_pairs = 0
        percent_score = 0.0
        reset_score = 0

        account_primary_used = account_primary.used_percent if account_primary is not None else None
        account_secondary_used = account_secondary.used_percent if account_secondary is not None else None
        account_primary_reset = account_primary.reset_at if account_primary is not None else None
        account_secondary_reset = account_secondary.reset_at if account_secondary is not None else None

        if sample_primary_used is not None and account_primary_used is not None:
            total_pairs += 1
            percent_pairs += 1
            percent_score += abs(sample_primary_used - account_primary_used)
        if sample_secondary_used is not None and account_secondary_used is not None:
            total_pairs += 1
            percent_pairs += 1
            percent_score += abs(sample_secondary_used - account_secondary_used)
        if primary_reset is not None and account_primary_reset is not None:
            total_pairs += 1
            reset_pairs += 1
            reset_score += abs(primary_reset - account_primary_reset)
        if secondary_reset is not None and account_secondary_reset is not None:
            total_pairs += 1
            reset_pairs += 1
            reset_score += abs(secondary_reset - account_secondary_reset)

        if total_pairs == 0:
            continue

        metrics = _SampleMatchMetrics(
            total_pairs=total_pairs,
            percent_pairs=percent_pairs,
            reset_pairs=reset_pairs,
            percent_score=percent_score,
            reset_score=reset_score,
        )
        sort_key = (
            -float(metrics.total_pairs),
            -float(metrics.percent_pairs),
            metrics.percent_score,
            -float(metrics.reset_pairs),
            float(metrics.reset_score),
        )

        if best_key is None or sort_key < best_key:
            if best_metrics is not None:
                second_metrics = best_metrics
            best_account_id = account_id
            best_metrics = metrics
            best_key = sort_key
        elif best_key is not None and sort_key == best_key:
            return None
        elif second_metrics is None:
            second_metrics = metrics

    if best_account_id is None or best_metrics is None:
        return None

    if best_metrics.percent_pairs > 0 and second_metrics is not None:
        comparable_shape = (
            best_metrics.total_pairs == second_metrics.total_pairs
            and best_metrics.percent_pairs == second_metrics.percent_pairs
        )
        if comparable_shape:
            margin = second_metrics.percent_score - best_metrics.percent_score
            reset_margin = second_metrics.reset_score - best_metrics.reset_score
            reset_fingerprint_breaks_tie = (
                best_metrics.reset_pairs > 0
                and second_metrics.reset_pairs > 0
                and reset_margin >= _RESET_FINGERPRINT_TIE_BREAK_SECONDS
            )
            if margin < 2.0 and not reset_fingerprint_breaks_tie:
                return None

    if best_metrics.percent_pairs == 0:
        if best_metrics.reset_pairs == 1 and best_metrics.reset_score > 300:
            return None
        if best_metrics.reset_pairs >= 2 and best_metrics.reset_score > 900:
            return None
        return best_account_id

    avg_percent_delta = best_metrics.percent_score / best_metrics.percent_pairs
    if best_metrics.percent_pairs == 1 and avg_percent_delta > 20.0:
        return None
    if best_metrics.percent_pairs >= 2 and avg_percent_delta > 30.0:
        return None

    return best_account_id
