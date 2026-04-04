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
    _sample_source_owner_cache,
    apply_local_live_usage_overrides,
)
from app.modules.accounts.schemas import AccountCodexAuthStatus


@pytest.fixture(autouse=True)
def _stub_runtime_live_session_counts(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )


@pytest.fixture(autouse=True)
def _clear_sample_source_owner_cache() -> None:
    _sample_source_owner_cache.clear()
    yield
    _sample_source_owner_cache.clear()


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


def test_apply_local_live_usage_overrides_marks_active_snapshot_live_from_runtime_sessions(
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
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {"snap-a": 2},
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
    assert codex_session_counts_by_account[account.id] == 2


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
    codex_auth_by_account = {
        account_a.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-a",
            active_snapshot_name="snap-a",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        account_b.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-b",
            active_snapshot_name="snap-a",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
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
        "app.modules.accounts.live_usage_overrides.has_recent_active_snapshot_process_fallback",
        lambda: False,
    )
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

    assert codex_session_counts_by_account[account_a.id] == 0
    assert codex_session_counts_by_account[account_b.id] == 0
    assert codex_auth_by_account[account_a.id].has_live_session is False
    assert codex_auth_by_account[account_b.id].has_live_session is False


def test_apply_local_live_usage_overrides_uses_recent_switch_process_fallback_without_env_flag(
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
        "app.modules.accounts.live_usage_overrides.has_recent_active_snapshot_process_fallback",
        lambda: True,
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "snap-a": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=42.0, reset_at=1_700_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=52.0, reset_at=1_703_700, window_minutes=10_080),
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
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
            ]
        },
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

    assert codex_session_counts_by_account[account_a.id] > 0
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


def test_fallback_mapping_updates_live_session_counts_but_keeps_quota_baseline_for_ambiguous_reset() -> None:
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
        live_usage_samples_by_snapshot={
            "snap-a": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=52.0, reset_at=shared_primary_reset, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=52.0, reset_at=shared_secondary_reset, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=52.0, reset_at=shared_primary_reset, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=52.0, reset_at=shared_secondary_reset, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account == {account_a.id: 2, account_b.id: 0}
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is False
    assert primary_usage[account_a.id].used_percent == baseline_primary[account_a.id].used_percent
    assert secondary_usage[account_a.id].used_percent == baseline_secondary[account_a.id].used_percent
    assert primary_usage[account_b.id].used_percent == baseline_primary[account_b.id].used_percent
    assert secondary_usage[account_b.id].used_percent == baseline_secondary[account_b.id].used_percent


def test_fallback_mapping_applies_quota_overrides_when_reset_matches_are_unique() -> None:
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
        live_usage_samples_by_snapshot={
            "snap-a": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=12.0, reset_at=1_300_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=21.0, reset_at=1_303_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=89.0, reset_at=1_300_900, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=76.0, reset_at=1_304_500, window_minutes=10_080),
                    stale=False,
                ),
            ]
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


def test_global_assignment_keeps_presence_only_samples_with_active_snapshot_without_quota_override() -> None:
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
        live_usage_samples_by_snapshot={
            "snap-1": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-c.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
            ]
        },
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account == {
        accounts[0].id: 3,
        accounts[1].id: 0,
        accounts[2].id: 0,
    }
    assert codex_auth_by_account[accounts[0].id].has_live_session is True
    assert codex_auth_by_account[accounts[1].id].has_live_session is False
    assert codex_auth_by_account[accounts[2].id].has_live_session is False
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


def test_apply_local_live_usage_overrides_uses_selected_snapshot_only(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "amodeus@example.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["amodeus", "viktor"]},
        active_snapshot_name="amodeus",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="amodeus",
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
            "amodeus": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=11.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=22.0, reset_at=1_903_700, window_minutes=10_080),
            ),
            "viktor": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=88.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=77.0, reset_at=1_903_700, window_minutes=10_080),
            ),
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "amodeus": [
                LocalCodexLiveUsageSample(
                    source="rollout-amodeus.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=11.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=22.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                )
            ],
            "viktor": [
                LocalCodexLiveUsageSample(
                    source="rollout-viktor.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=88.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=77.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                )
            ],
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"amodeus": 1, "viktor": 1},
    )

    apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    debug = debug_by_account[account.id]
    assert debug.snapshots_considered == ["amodeus"]
    assert [sample.snapshot_name for sample in debug.raw_samples] == ["amodeus"]
    assert primary_usage[account.id].used_percent == pytest.approx(11.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(22.0)


def test_apply_local_live_usage_overrides_applies_conservative_floor_for_deactivated_accounts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    disconnected = _make_account("acc-a", "a@example.com")
    disconnected.status = AccountStatus.DEACTIVATED
    healthy = _make_account("acc-b", "b@example.com")
    accounts = [disconnected, healthy]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={disconnected.id: ["viktor"], healthy.id: ["other"]},
        active_snapshot_name="viktor",
    )
    codex_auth_by_account = {
        disconnected.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="viktor",
            active_snapshot_name="viktor",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        healthy.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="other",
            active_snapshot_name="viktor",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        disconnected.id: _usage_entry(
            account_id=disconnected.id,
            window="primary",
            used_percent=7.0,
            reset_at=1_900_100,
            window_minutes=300,
        )
    }
    secondary_usage = {
        disconnected.id: _usage_entry(
            account_id=disconnected.id,
            window="secondary",
            used_percent=100.0,
            reset_at=1_903_700,
            window_minutes=10_080,
        )
    }
    codex_session_counts_by_account = {disconnected.id: 0, healthy.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "viktor": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=95.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=37.0, reset_at=1_903_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "viktor": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=95.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=37.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=76.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=34.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    candidates = apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    assert primary_usage[disconnected.id].used_percent == pytest.approx(95.0)
    assert secondary_usage[disconnected.id].used_percent == pytest.approx(37.0)
    assert len(candidates) == 2
    assert {candidate.window for candidate in candidates} == {"primary", "secondary"}
    debug = debug_by_account[disconnected.id]
    assert debug.override_applied is True
    assert debug.override_reason == "deferred_active_snapshot_mixed_default_sessions_conservative_floor"


def test_apply_local_live_usage_overrides_relabels_default_samples_to_matched_account_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cica = _make_account("acc-cica", "cica@example.com")
    amodeus = _make_account("acc-amodeus", "amodeus@example.com")
    accounts = [cica, amodeus]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            cica.id: ["cica"],
            amodeus.id: ["amodeus"],
        },
        active_snapshot_name="cica",
    )
    codex_auth_by_account = {
        cica.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="cica",
            active_snapshot_name="cica",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        amodeus.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="cica",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    # Baseline usage windows provide attribution anchors for default-session samples.
    primary_usage = {
        cica.id: _usage_entry(
            account_id=cica.id,
            window="primary",
            used_percent=5.0,
            reset_at=2_000_100,
            window_minutes=300,
        ),
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="primary",
            used_percent=27.0,
            reset_at=2_000_900,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        cica.id: _usage_entry(
            account_id=cica.id,
            window="secondary",
            used_percent=6.0,
            reset_at=2_003_700,
            window_minutes=10_080,
        ),
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="secondary",
            used_percent=3.0,
            reset_at=2_004_500,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {cica.id: 0, amodeus.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "cica": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=5.0, reset_at=2_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=6.0, reset_at=2_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "cica": [
                LocalCodexLiveUsageSample(
                    source="rollout-amodeus.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=27.0, reset_at=2_000_900, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=3.0, reset_at=2_004_500, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-cica.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=5.0, reset_at=2_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=6.0, reset_at=2_003_700, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    cica_debug = debug_by_account[cica.id]
    amodeus_debug = debug_by_account[amodeus.id]
    assert [sample.source for sample in cica_debug.raw_samples] == ["rollout-cica.jsonl"]
    assert [sample.snapshot_name for sample in cica_debug.raw_samples] == ["cica"]
    assert [sample.source for sample in amodeus_debug.raw_samples] == ["rollout-amodeus.jsonl"]
    assert [sample.snapshot_name for sample in amodeus_debug.raw_samples] == ["amodeus"]


def test_apply_local_live_usage_overrides_keeps_cached_source_ownership_across_snapshot_switch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cica = _make_account("acc-cica", "cica@example.com")
    amodeus = _make_account("acc-amodeus", "amodeus@example.com")
    accounts = [cica, amodeus]

    seed_snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={cica.id: ["cica"], amodeus.id: ["amodeus"]},
        active_snapshot_name="cica",
    )
    seed_auth_by_account = {
        cica.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="cica",
            active_snapshot_name="cica",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        amodeus.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="cica",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "cica": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=20.0, reset_at=2_100_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=30.0, reset_at=2_103_700, window_minutes=10_080),
            ),
            "amodeus": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=70.0, reset_at=2_100_900, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=80.0, reset_at=2_104_500, window_minutes=10_080),
            ),
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "cica": [
                LocalCodexLiveUsageSample(
                    source="rollout-cica.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=20.0, reset_at=2_100_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=30.0, reset_at=2_103_700, window_minutes=10_080),
                    stale=False,
                )
            ],
            "amodeus": [
                LocalCodexLiveUsageSample(
                    source="rollout-amodeus.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=70.0, reset_at=2_100_900, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=80.0, reset_at=2_104_500, window_minutes=10_080),
                    stale=False,
                )
            ],
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"cica": 1, "amodeus": 1},
    )
    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=seed_snapshot_index,
        codex_auth_by_account=seed_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account={cica.id: 0, amodeus.id: 0},
        live_quota_debug_by_account={},
    )

    switched_snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={cica.id: ["cica"], amodeus.id: ["amodeus"]},
        active_snapshot_name="amodeus",
    )
    switched_auth_by_account = {
        cica.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="cica",
            active_snapshot_name="amodeus",
            is_active_snapshot=False,
            has_live_session=False,
        ),
        amodeus.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="amodeus",
            is_active_snapshot=True,
            has_live_session=False,
        ),
    }
    debug_by_account = {}

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "amodeus": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=70.0, reset_at=2_100_900, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=80.0, reset_at=2_104_500, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "amodeus": [
                LocalCodexLiveUsageSample(
                    source="rollout-cica.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-amodeus.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=switched_snapshot_index,
        codex_auth_by_account=switched_auth_by_account,
        primary_usage={
            cica.id: _usage_entry(
                account_id=cica.id,
                window="primary",
                used_percent=20.0,
                reset_at=2_100_100,
                window_minutes=300,
            ),
            amodeus.id: _usage_entry(
                account_id=amodeus.id,
                window="primary",
                used_percent=70.0,
                reset_at=2_100_900,
                window_minutes=300,
            ),
        },
        secondary_usage={
            cica.id: _usage_entry(
                account_id=cica.id,
                window="secondary",
                used_percent=30.0,
                reset_at=2_103_700,
                window_minutes=10_080,
            ),
            amodeus.id: _usage_entry(
                account_id=amodeus.id,
                window="secondary",
                used_percent=80.0,
                reset_at=2_104_500,
                window_minutes=10_080,
            ),
        },
        codex_live_session_counts_by_account={cica.id: 0, amodeus.id: 0},
        live_quota_debug_by_account=debug_by_account,
    )

    cica_debug = debug_by_account[cica.id]
    amodeus_debug = debug_by_account[amodeus.id]
    assert [sample.source for sample in cica_debug.raw_samples] == ["rollout-cica.jsonl"]
    assert [sample.source for sample in amodeus_debug.raw_samples] == ["rollout-amodeus.jsonl"]


def test_apply_local_live_usage_overrides_hides_ambiguous_default_samples_in_debug(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    cica = _make_account("acc-cica", "cica@example.com")
    amodeus = _make_account("acc-amodeus", "amodeus@example.com")
    accounts = [cica, amodeus]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            cica.id: ["cica"],
            amodeus.id: ["amodeus"],
        },
        active_snapshot_name="cica",
    )
    codex_auth_by_account = {
        cica.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="cica",
            active_snapshot_name="cica",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        amodeus.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="cica",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        cica.id: _usage_entry(
            account_id=cica.id,
            window="primary",
            used_percent=10.0,
            reset_at=2_000_100,
            window_minutes=300,
        ),
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="primary",
            used_percent=11.0,
            reset_at=2_000_200,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        cica.id: _usage_entry(
            account_id=cica.id,
            window="secondary",
            used_percent=20.0,
            reset_at=2_003_700,
            window_minutes=10_080,
        ),
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="secondary",
            used_percent=21.0,
            reset_at=2_003_800,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {cica.id: 0, amodeus.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "cica": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=10.0, reset_at=2_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=20.0, reset_at=2_003_700, window_minutes=10_080),
            )
        },
    )
    # Two default-scope samples with no reset fingerprints and tiny percent
    # deltas across accounts -> ambiguous attribution.
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "cica": [
                LocalCodexLiveUsageSample(
                    source="rollout-unknown-a.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=10.4, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=20.4, reset_at=None, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-unknown-b.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=10.6, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=20.6, reset_at=None, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    assert debug_by_account[cica.id].raw_samples == []
    assert debug_by_account[amodeus.id].raw_samples == []


def test_apply_local_live_usage_overrides_applies_confident_deferred_sample_override_for_active_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    amodeus = _make_account("acc-amodeus", "amodeus@example.com")
    cica = _make_account("acc-cica", "cica@example.com")
    accounts = [amodeus, cica]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            amodeus.id: ["amodeus"],
            cica.id: ["cica"],
        },
        active_snapshot_name="amodeus",
    )
    codex_auth_by_account = {
        amodeus.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="amodeus",
            active_snapshot_name="amodeus",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        cica.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="cica",
            active_snapshot_name="amodeus",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="primary",
            used_percent=42.0,
            reset_at=3_000_100,
            window_minutes=300,
        ),
        cica.id: _usage_entry(
            account_id=cica.id,
            window="primary",
            used_percent=7.0,
            reset_at=3_000_900,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        amodeus.id: _usage_entry(
            account_id=amodeus.id,
            window="secondary",
            used_percent=93.0,
            reset_at=3_003_700,
            window_minutes=10_080,
        ),
        cica.id: _usage_entry(
            account_id=cica.id,
            window="secondary",
            used_percent=5.0,
            reset_at=3_004_500,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {amodeus.id: 0, cica.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 15, 40, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "amodeus": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=42.0, reset_at=3_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=93.0, reset_at=3_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "amodeus": [
                LocalCodexLiveUsageSample(
                    source="rollout-amodeus.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=69.0, reset_at=3_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=96.0, reset_at=3_003_700, window_minutes=10_080),
                    stale=False,
                )
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    candidates = apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=codex_session_counts_by_account,
        live_quota_debug_by_account=debug_by_account,
    )

    assert primary_usage[amodeus.id].used_percent == pytest.approx(69.0)
    assert secondary_usage[amodeus.id].used_percent == pytest.approx(96.0)
    assert len(candidates) == 2
    debug = debug_by_account[amodeus.id]
    assert debug.override_applied is True
    assert debug.override_reason == "deferred_active_snapshot_confident_sample_override"
