from __future__ import annotations

from app.db.models import UsageHistory
from app.modules.accounts.live_usage_overrides import LiveUsageOverridePersistCandidate
from app.modules.usage.repository import UsageRepository

_WINDOW_PRIMARY = "primary"


def _normalize_window(window: str | None) -> str:
    if not window:
        return _WINDOW_PRIMARY
    return window


def _matches_candidate(
    *,
    existing: UsageHistory,
    candidate: LiveUsageOverridePersistCandidate,
) -> bool:
    percent_delta = abs(float(existing.used_percent) - float(candidate.used_percent))
    return (
        _normalize_window(existing.window) == candidate.window
        and percent_delta < 1e-6
        and existing.reset_at == candidate.reset_at
        and existing.window_minutes == candidate.window_minutes
    )


async def persist_live_usage_overrides(
    *,
    usage_repo: UsageRepository,
    candidates: list[LiveUsageOverridePersistCandidate],
) -> None:
    for candidate in candidates:
        latest = await usage_repo.latest_entry_for_account(
            candidate.account_id,
            window=candidate.window,
        )
        if latest is not None:
            if _matches_candidate(existing=latest, candidate=candidate):
                continue
            latest_recorded_at = latest.recorded_at
            if latest_recorded_at >= candidate.recorded_at:
                continue

        await usage_repo.add_entry(
            account_id=candidate.account_id,
            used_percent=float(candidate.used_percent),
            recorded_at=candidate.recorded_at,
            window=candidate.window,
            reset_at=candidate.reset_at,
            window_minutes=candidate.window_minutes,
        )
