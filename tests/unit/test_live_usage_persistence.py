from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

import pytest

from app.db.models import UsageHistory
from app.modules.accounts.live_usage_overrides import LiveUsageOverridePersistCandidate
from app.modules.accounts.live_usage_persistence import persist_live_usage_overrides


def _usage_entry(
    *,
    account_id: str,
    window: str,
    used_percent: float,
    reset_at: int,
    window_minutes: int,
    recorded_at: datetime,
) -> UsageHistory:
    return UsageHistory(
        account_id=account_id,
        window=window,
        used_percent=used_percent,
        reset_at=reset_at,
        window_minutes=window_minutes,
        recorded_at=recorded_at,
    )


def _candidate(
    *,
    account_id: str,
    window: Literal["primary", "secondary"],
    used_percent: float,
    reset_at: int,
    window_minutes: int,
    recorded_at: datetime,
) -> LiveUsageOverridePersistCandidate:
    return LiveUsageOverridePersistCandidate(
        account_id=account_id,
        window=window,
        used_percent=used_percent,
        reset_at=reset_at,
        window_minutes=window_minutes,
        recorded_at=recorded_at,
    )


class _FakeUsageRepo:
    def __init__(self, latest_by_key: dict[tuple[str, str], UsageHistory] | None = None) -> None:
        self.latest_by_key = latest_by_key or {}
        self.added: list[LiveUsageOverridePersistCandidate] = []

    async def latest_entry_for_account(self, account_id: str, *, window: str | None = None) -> UsageHistory | None:
        key = (account_id, "primary" if window in (None, "", "primary") else window)
        return self.latest_by_key.get(key)

    async def add_entry(
        self,
        account_id: str,
        used_percent: float,
        *,
        recorded_at: datetime | None = None,
        window: str | None = None,
        reset_at: int | None = None,
        window_minutes: int | None = None,
        **_: object,
    ) -> UsageHistory:
        candidate = LiveUsageOverridePersistCandidate(
            account_id=account_id,
            window=(window or "primary"),
            used_percent=used_percent,
            reset_at=reset_at,
            window_minutes=window_minutes,
            recorded_at=recorded_at or datetime.now(timezone.utc),
        )
        self.added.append(candidate)
        self.latest_by_key[(candidate.account_id, candidate.window)] = _usage_entry(
            account_id=candidate.account_id,
            window=candidate.window,
            used_percent=candidate.used_percent,
            reset_at=candidate.reset_at or 0,
            window_minutes=candidate.window_minutes or 0,
            recorded_at=candidate.recorded_at,
        )
        return self.latest_by_key[(candidate.account_id, candidate.window)]


@pytest.mark.asyncio
async def test_persist_live_usage_overrides_writes_when_candidate_is_newer_and_changed() -> None:
    now = datetime(2026, 4, 3, 19, 0, tzinfo=timezone.utc)
    repo = _FakeUsageRepo(
        {
            ("acc-1", "primary"): _usage_entry(
                account_id="acc-1",
                window="primary",
                used_percent=20.0,
                reset_at=1_700_000_000,
                window_minutes=300,
                recorded_at=now,
            )
        }
    )

    await persist_live_usage_overrides(
        usage_repo=repo,  # type: ignore[arg-type]
        candidates=[
            _candidate(
                account_id="acc-1",
                window="primary",
                used_percent=42.0,
                reset_at=1_700_000_100,
                window_minutes=300,
                recorded_at=now.replace(minute=5),
            )
        ],
    )

    assert len(repo.added) == 1
    assert repo.added[0].used_percent == pytest.approx(42.0)


@pytest.mark.asyncio
async def test_persist_live_usage_overrides_skips_when_values_are_unchanged() -> None:
    now = datetime(2026, 4, 3, 19, 0, tzinfo=timezone.utc)
    repo = _FakeUsageRepo(
        {
            ("acc-1", "secondary"): _usage_entry(
                account_id="acc-1",
                window="secondary",
                used_percent=61.0,
                reset_at=1_700_123_456,
                window_minutes=10080,
                recorded_at=now,
            )
        }
    )

    await persist_live_usage_overrides(
        usage_repo=repo,  # type: ignore[arg-type]
        candidates=[
            _candidate(
                account_id="acc-1",
                window="secondary",
                used_percent=61.0,
                reset_at=1_700_123_456,
                window_minutes=10080,
                recorded_at=now.replace(minute=30),
            )
        ],
    )

    assert repo.added == []


@pytest.mark.asyncio
async def test_persist_live_usage_overrides_skips_when_candidate_is_not_newer() -> None:
    now = datetime(2026, 4, 3, 19, 0, tzinfo=timezone.utc)
    repo = _FakeUsageRepo(
        {
            ("acc-1", "primary"): _usage_entry(
                account_id="acc-1",
                window="primary",
                used_percent=30.0,
                reset_at=1_700_000_500,
                window_minutes=300,
                recorded_at=now.replace(minute=20),
            )
        }
    )

    await persist_live_usage_overrides(
        usage_repo=repo,  # type: ignore[arg-type]
        candidates=[
            _candidate(
                account_id="acc-1",
                window="primary",
                used_percent=55.0,
                reset_at=1_700_000_700,
                window_minutes=300,
                recorded_at=now.replace(minute=10),
            )
        ],
    )

    assert repo.added == []
