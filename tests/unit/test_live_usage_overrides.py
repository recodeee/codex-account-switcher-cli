from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.crypto import TokenEncryptor
from app.db.models import Account, AccountStatus, UsageHistory
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalCodexLiveUsageSample,
    LocalUsageWindow,
)
from app.modules.accounts.live_usage_overrides import (
    _apply_local_default_session_fingerprint_overrides,
    _match_sample_to_account,
    _resolve_sample_account_assignments,
    apply_local_live_usage_overrides,
)
from app.modules.accounts.schemas import AccountCodexAuthStatus


def _make_account(account_id: str, email: str) -> Account:
    encryptor = TokenEncryptor()
    return Account(
        id=account_id,
        chatgpt_account_id=f"chatgpt-{account_id}",
        email=email,
        plan_type="plus",
        access_token_encrypted=encryptor.encrypt("access"),
        refresh_token_encrypted=encryptor.encrypt("refresh"),
        id_token_encrypted=encryptor.encrypt("id"),
        last_refresh=datetime.now(tz=timezone.utc),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )


def _usage_entry(
    *,
    account_id: str,
    window: str,
    used_percent: float,
    reset_at: int | None,
    window_minutes: int,
) -> UsageHistory:
    return UsageHistory(
        account_id=account_id,
        window=window,
        used_percent=used_percent,
        reset_at=reset_at,
        window_minutes=window_minutes,
        recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
    )


def _live_sample(
    *,
    recorded_at: datetime,
    primary_used: float,
    secondary_used: float,
    primary_reset: int | None,
    secondary_reset: int | None,
) -> LocalCodexLiveUsage:
    primary = (
        LocalUsageWindow(used_percent=primary_used, reset_at=primary_reset, window_minutes=300)
        if primary_used is not None
        else None
    )
    secondary = (
        LocalUsageWindow(used_percent=secondary_used, reset_at=secondary_reset, window_minutes=10_080)
        if secondary_used is not None
        else None
    )
    return LocalCodexLiveUsage(
        recorded_at=recorded_at,
        active_session_count=1,
        primary=primary,
        secondary=secondary,
    )


def _presence_sample(*, recorded_at: datetime) -> LocalCodexLiveUsage:
    return LocalCodexLiveUsage(
        recorded_at=recorded_at,
        active_session_count=1,
        primary=None,
        secondary=None,
    )


def _status_map(
    accounts: list[Account],
    *,
    active_snapshot_name: str = "snap-1",
) -> dict[str, AccountCodexAuthStatus]:
    statuses: dict[str, AccountCodexAuthStatus] = {}
    for index, account in enumerate(accounts, start=1):
        statuses[account.id] = AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name=f"snap-{index}",
            active_snapshot_name=active_snapshot_name,
            is_active_snapshot=index == 1,
            has_live_session=False,
        )
    return statuses


def test_apply_local_live_usage_overrides_marks_active_snapshot_live_from_process_fallback(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "a@example.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["snap-a"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-a",
            active_snapshot_name="snap-a",
            is_active_snapshot=True,
            has_live_session=False,
        )
    }
    codex_session_counts_by_account = {account.id: 0}

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"snap-a": 1},
    )

    candidates = apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert candidates == []
    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 1


def test_apply_local_live_usage_overrides_skips_mixed_default_session_fallback_when_process_counts_exist(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account_a.id: ["snap-a"], account_b.id: ["snap-b"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = _status_map(accounts, active_snapshot_name="snap-a")
    primary_usage: dict[str, UsageHistory] = {}
    secondary_usage: dict[str, UsageHistory] = {}
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "snap-a": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=42.0, reset_at=1_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=52.0, reset_at=1_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [_presence_sample(recorded_at=now), _presence_sample(recorded_at=now)],
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"snap-a": 2},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account[account_a.id] == 2
    assert codex_session_counts_by_account[account_b.id] == 0
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is False


def test_apply_local_live_usage_overrides_disables_default_session_fingerprint_fallback_by_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account_a.id: ["snap-a"], account_b.id: ["snap-b"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = _status_map(accounts, active_snapshot_name="snap-a")
    primary_usage: dict[str, UsageHistory] = {}
    secondary_usage: dict[str, UsageHistory] = {}
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.delenv("CODEX_LB_DEFAULT_SESSION_FINGERPRINT_FALLBACK_ENABLED", raising=False)
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "snap-a": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=3,
                primary=LocalUsageWindow(used_percent=42.0, reset_at=1_700_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=52.0, reset_at=1_703_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [_presence_sample(recorded_at=now), _presence_sample(recorded_at=now), _presence_sample(recorded_at=now)],
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account[account_a.id] == 1
    assert codex_session_counts_by_account[account_b.id] == 0
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is False


def test_match_sample_prefers_unique_reset_fingerprint_over_percent_similarity() -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]

    baseline_primary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="primary", used_percent=90.0, reset_at=1_000_100, window_minutes=300),
        account_b.id: _usage_entry(account_id=account_b.id, window="primary", used_percent=10.0, reset_at=1_000_900, window_minutes=300),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="secondary", used_percent=45.0, reset_at=1_004_100, window_minutes=10_080),
        account_b.id: _usage_entry(account_id=account_b.id, window="secondary", used_percent=45.0, reset_at=1_004_100, window_minutes=10_080),
    }
    sample = _live_sample(
        recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
        primary_used=90.0,
        secondary_used=90.0,
        primary_reset=1_000_900,
        secondary_reset=1_004_500,
    )

    matched = _match_sample_to_account(
        sample=sample,
        accounts=accounts,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )

    assert matched is not None
    assert matched.account_id == account_b.id
    assert matched.confidence == "high"
    assert matched.allows_quota_override is True


def test_match_sample_high_confidence_percent_fallback_does_not_allow_quota_override() -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]

    shared_primary_reset = 1_100_100
    shared_secondary_reset = 1_103_700
    baseline_primary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="primary", used_percent=20.0, reset_at=shared_primary_reset, window_minutes=300),
        account_b.id: _usage_entry(account_id=account_b.id, window="primary", used_percent=72.0, reset_at=shared_primary_reset, window_minutes=300),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="secondary", used_percent=30.0, reset_at=shared_secondary_reset, window_minutes=10_080),
        account_b.id: _usage_entry(account_id=account_b.id, window="secondary", used_percent=82.0, reset_at=shared_secondary_reset, window_minutes=10_080),
    }
    sample = _live_sample(
        recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
        primary_used=22.0,
        secondary_used=32.0,
        primary_reset=shared_primary_reset,
        secondary_reset=shared_secondary_reset,
    )

    matched = _match_sample_to_account(
        sample=sample,
        accounts=accounts,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )

    assert matched is not None
    assert matched.account_id == account_a.id
    assert matched.confidence == "high"
    assert matched.allows_quota_override is False


def test_fallback_mapping_updates_live_session_counts_but_keeps_quota_baseline_for_ambiguous_reset(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account_a.id: ["snap-a"], account_b.id: ["snap-b"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = _status_map(accounts, active_snapshot_name="snap-a")

    shared_primary_reset = 1_200_100
    shared_secondary_reset = 1_203_700
    baseline_primary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="primary", used_percent=50.0, reset_at=shared_primary_reset, window_minutes=300),
        account_b.id: _usage_entry(account_id=account_b.id, window="primary", used_percent=54.0, reset_at=shared_primary_reset, window_minutes=300),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="secondary", used_percent=50.0, reset_at=shared_secondary_reset, window_minutes=10_080),
        account_b.id: _usage_entry(account_id=account_b.id, window="secondary", used_percent=54.0, reset_at=shared_secondary_reset, window_minutes=10_080),
    }
    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [
            _live_sample(
                recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
                primary_used=52.0,
                secondary_used=52.0,
                primary_reset=shared_primary_reset,
                secondary_reset=shared_secondary_reset,
            ),
            _live_sample(
                recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc),
                primary_used=52.0,
                secondary_used=52.0,
                primary_reset=shared_primary_reset,
                secondary_reset=shared_secondary_reset,
            ),
        ],
    )

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot={
            "snap-a": LocalCodexLiveUsage(
                recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=58.0, reset_at=1_200_500, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=58.0, reset_at=1_204_100, window_minutes=10_080),
            )
        },
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert sum(codex_session_counts_by_account.values()) == 2
    assert all(status.has_live_session for status in codex_auth_by_account.values())
    assert primary_usage[account_a.id].used_percent == baseline_primary[account_a.id].used_percent
    assert secondary_usage[account_a.id].used_percent == baseline_secondary[account_a.id].used_percent
    assert primary_usage[account_b.id].used_percent == baseline_primary[account_b.id].used_percent
    assert secondary_usage[account_b.id].used_percent == baseline_secondary[account_b.id].used_percent


def test_fallback_mapping_applies_quota_overrides_when_reset_matches_are_unique(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account_a.id: ["snap-a"], account_b.id: ["snap-b"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = _status_map(accounts, active_snapshot_name="snap-a")

    baseline_primary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="primary", used_percent=11.0, reset_at=1_300_100, window_minutes=300),
        account_b.id: _usage_entry(account_id=account_b.id, window="primary", used_percent=88.0, reset_at=1_300_900, window_minutes=300),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="secondary", used_percent=22.0, reset_at=1_303_700, window_minutes=10_080),
        account_b.id: _usage_entry(account_id=account_b.id, window="secondary", used_percent=77.0, reset_at=1_304_500, window_minutes=10_080),
    }
    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [
            _live_sample(
                recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
                primary_used=12.0,
                secondary_used=21.0,
                primary_reset=1_300_100,
                secondary_reset=1_303_700,
            ),
            _live_sample(
                recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc),
                primary_used=89.0,
                secondary_used=76.0,
                primary_reset=1_300_900,
                secondary_reset=1_304_500,
            ),
        ],
    )

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot={
            "snap-a": LocalCodexLiveUsage(
                recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=58.0, reset_at=1_300_500, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=58.0, reset_at=1_304_100, window_minutes=10_080),
            )
        },
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account == {account_a.id: 1, account_b.id: 1}
    assert primary_usage[account_a.id].used_percent == pytest.approx(12.0)
    assert secondary_usage[account_a.id].used_percent == pytest.approx(21.0)
    assert primary_usage[account_b.id].used_percent == pytest.approx(89.0)
    assert secondary_usage[account_b.id].used_percent == pytest.approx(76.0)


def test_global_assignment_is_deterministic_across_account_and_sample_order_for_five_accounts() -> None:
    accounts = [_make_account(f"acc-{idx}", f"user{idx}@example.com") for idx in range(1, 6)]
    baseline_primary: dict[str, UsageHistory] = {}
    baseline_secondary: dict[str, UsageHistory] = {}
    for idx, account in enumerate(accounts, start=1):
        baseline_primary[account.id] = _usage_entry(
            account_id=account.id,
            window="primary",
            used_percent=float(idx * 10),
            reset_at=1_400_000,
            window_minutes=300,
        )
        baseline_secondary[account.id] = _usage_entry(
            account_id=account.id,
            window="secondary",
            used_percent=float(idx * 10),
            reset_at=1_403_600,
            window_minutes=10_080,
        )

    samples = [
        _live_sample(recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc), primary_used=11.0, secondary_used=11.0, primary_reset=1_400_000, secondary_reset=1_403_600),
        _live_sample(recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc), primary_used=19.0, secondary_used=19.0, primary_reset=1_400_000, secondary_reset=1_403_600),
        _live_sample(recorded_at=datetime(2026, 4, 3, 12, 2, tzinfo=timezone.utc), primary_used=31.0, secondary_used=31.0, primary_reset=1_400_000, secondary_reset=1_403_600),
        _live_sample(recorded_at=datetime(2026, 4, 3, 12, 3, tzinfo=timezone.utc), primary_used=41.0, secondary_used=41.0, primary_reset=1_400_000, secondary_reset=1_403_600),
        _live_sample(recorded_at=datetime(2026, 4, 3, 12, 4, tzinfo=timezone.utc), primary_used=49.0, secondary_used=49.0, primary_reset=1_400_000, secondary_reset=1_403_600),
    ]

    first = _resolve_sample_account_assignments(
        samples=samples,
        accounts=accounts,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )
    first_mapping = {samples[idx].primary.used_percent: match.account_id for idx, match in first.items()}

    reversed_samples = list(reversed(samples))
    second = _resolve_sample_account_assignments(
        samples=reversed_samples,
        accounts=list(reversed(accounts)),
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )
    second_mapping = {reversed_samples[idx].primary.used_percent: match.account_id for idx, match in second.items()}

    assert first_mapping == second_mapping


def test_global_assignment_spreads_presence_only_samples_for_recall_without_quota_override(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    accounts = [_make_account(f"acc-{idx}", f"user{idx}@example.com") for idx in range(1, 4)]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: [f"snap-{idx}"] for idx, account in enumerate(accounts, start=1)},
        active_snapshot_name="snap-1",
    )
    codex_auth_by_account = _status_map(accounts, active_snapshot_name="snap-1")
    baseline_primary = {
        account.id: _usage_entry(account_id=account.id, window="primary", used_percent=float(idx * 12), reset_at=1_500_000 + idx, window_minutes=300)
        for idx, account in enumerate(accounts, start=1)
    }
    baseline_secondary = {
        account.id: _usage_entry(account_id=account.id, window="secondary", used_percent=float(idx * 9), reset_at=1_503_600 + idx, window_minutes=10_080)
        for idx, account in enumerate(accounts, start=1)
    }
    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account.id: 0 for account in accounts}
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [_presence_sample(recorded_at=now), _presence_sample(recorded_at=now), _presence_sample(recorded_at=now)],
    )

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot={
            "snap-1": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=3,
                primary=LocalUsageWindow(used_percent=25.0, reset_at=1_510_000, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=35.0, reset_at=1_513_600, window_minutes=10_080),
            )
        },
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert sorted(codex_session_counts_by_account.values()) == [1, 1, 1]
    assert all(status.has_live_session for status in codex_auth_by_account.values())
    for account in accounts:
        assert primary_usage[account.id].used_percent == baseline_primary[account.id].used_percent
        assert secondary_usage[account.id].used_percent == baseline_secondary[account.id].used_percent


def test_apply_local_live_usage_overrides_populates_debug_payload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "a@example.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["snap-a"]},
        active_snapshot_name="snap-a",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-a",
            active_snapshot_name="snap-a",
            is_active_snapshot=True,
            has_live_session=False,
        )
    }
    primary_usage: dict[str, UsageHistory] = {}
    secondary_usage: dict[str, UsageHistory] = {}
    codex_session_counts_by_account = {account.id: 0}
    debug_by_account = {}

    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "snap-a": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=83.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=23.0, reset_at=1_903_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "snap-a": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=58.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=22.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=42.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=25.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"snap-a": 2},
    )

    candidates = apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    assert len(candidates) == 2
    debug = debug_by_account[account.id]
    assert debug.override_applied is True
    assert debug.override_reason == "applied_live_usage_windows"
    assert debug.merged is not None
    assert debug.merged.primary is not None
    assert debug.merged.primary.remaining_percent == pytest.approx(17.0)
    assert len(debug.raw_samples) == 2
