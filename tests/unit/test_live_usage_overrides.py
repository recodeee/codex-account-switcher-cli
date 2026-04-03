from __future__ import annotations

from datetime import datetime, timezone

import pytest

from app.core.crypto import TokenEncryptor
from app.db.models import Account, AccountStatus, UsageHistory
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_live_usage import LocalCodexLiveUsage, LocalUsageWindow
from app.modules.accounts.live_usage_overrides import (
    _apply_local_default_session_fingerprint_overrides,
    _match_sample_to_account,
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
    reset_at: int,
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


def _sample(*, used_percent: float, reset_at: int) -> LocalCodexLiveUsage:
    return LocalCodexLiveUsage(
        recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
        active_session_count=1,
        primary=LocalUsageWindow(used_percent=used_percent, reset_at=reset_at, window_minutes=300),
        secondary=LocalUsageWindow(used_percent=used_percent, reset_at=reset_at + 3_600, window_minutes=10_080),
    )


def test_fallback_fingerprint_matching_updates_session_counts_and_overrides_usage_when_reset_is_unique(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]

    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            account_a.id: ["snap-a"],
            account_b.id: ["snap-b"],
        },
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

    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=91.0,
            reset_at=1_717_000_100,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=47.0,
            reset_at=1_717_000_900,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=62.0,
            reset_at=1_717_003_700,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=34.0,
            reset_at=1_717_004_500,
            window_minutes=10_080,
        ),
    }

    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    live_usage_by_snapshot = {
        "snap-a": LocalCodexLiveUsage(
            recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
            active_session_count=2,
            primary=LocalUsageWindow(used_percent=58.0, reset_at=1_717_000_500, window_minutes=300),
            secondary=LocalUsageWindow(used_percent=58.0, reset_at=1_717_004_100, window_minutes=10_080),
        )
    }

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [
            _sample(used_percent=90.0, reset_at=1_717_000_100),
            _sample(used_percent=48.0, reset_at=1_717_000_900),
        ],
    )

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot=live_usage_by_snapshot,
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account == {account_a.id: 1, account_b.id: 1}
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is True

    assert primary_usage[account_a.id].used_percent == 90.0
    assert primary_usage[account_a.id].reset_at == 1_717_000_100
    assert primary_usage[account_b.id].used_percent == 48.0
    assert primary_usage[account_b.id].reset_at == 1_717_000_900
    assert secondary_usage[account_a.id].used_percent == 90.0
    assert secondary_usage[account_a.id].reset_at == 1_717_003_700
    assert secondary_usage[account_b.id].used_percent == 48.0
    assert secondary_usage[account_b.id].reset_at == 1_717_004_500


def test_fallback_fingerprint_matching_keeps_baseline_usage_when_reset_is_not_unique(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]

    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            account_a.id: ["snap-a"],
            account_b.id: ["snap-b"],
        },
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

    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=91.0,
            reset_at=1_717_000_100,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=47.0,
            reset_at=1_717_000_100,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=62.0,
            reset_at=1_717_003_700,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=34.0,
            reset_at=1_717_003_700,
            window_minutes=10_080,
        ),
    }

    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    live_usage_by_snapshot = {
        "snap-a": LocalCodexLiveUsage(
            recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
            active_session_count=2,
            primary=LocalUsageWindow(used_percent=58.0, reset_at=1_717_000_500, window_minutes=300),
            secondary=LocalUsageWindow(used_percent=58.0, reset_at=1_717_004_100, window_minutes=10_080),
        )
    }

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples",
        lambda: [
            _sample(used_percent=90.0, reset_at=1_717_000_100),
            _sample(used_percent=48.0, reset_at=1_717_000_100),
        ],
    )

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot=live_usage_by_snapshot,
        codex_auth_by_account=codex_auth_by_account,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account == {account_a.id: 1, account_b.id: 1}
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is True

    assert primary_usage[account_a.id].used_percent == baseline_primary[account_a.id].used_percent
    assert primary_usage[account_b.id].used_percent == baseline_primary[account_b.id].used_percent
    assert secondary_usage[account_a.id].used_percent == baseline_secondary[account_a.id].used_percent
    assert secondary_usage[account_b.id].used_percent == baseline_secondary[account_b.id].used_percent


def test_match_sample_uses_reset_fingerprint_when_percent_gap_is_ambiguous() -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]

    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=52.0,
            reset_at=1_717_000_100,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=52.0,
            reset_at=1_717_003_600,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=38.0,
            reset_at=1_717_000_000,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=38.0,
            reset_at=1_717_007_200,
            window_minutes=10_080,
        ),
    }

    sample = _sample(used_percent=52.0, reset_at=1_717_003_600)
    matched = _match_sample_to_account(
        sample=sample,
        accounts=accounts,
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )

    assert matched == account_b.id
