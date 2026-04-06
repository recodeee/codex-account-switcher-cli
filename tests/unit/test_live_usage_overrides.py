from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.core.auth import generate_unique_account_id
from app.core.crypto import TokenEncryptor
from app.db.models import Account, AccountStatus, UsageHistory
from app.modules.accounts.codex_auth_switcher import CodexAuthSnapshotIndex
from app.modules.accounts.codex_live_usage import (
    LocalCodexLiveUsage,
    LocalCodexLiveUsageSample,
    LocalUsageWindow,
)
from app.modules.accounts.live_usage_overrides import (
    _build_default_sample_debug_overrides,
    _apply_local_default_session_fingerprint_overrides,
    _match_sample_to_account,
    _resolve_sample_account_assignments,
    _sample_source_owner_cache,
    _terminated_cli_session_snapshot_cache,
    apply_local_live_usage_overrides,
    remember_terminated_cli_session_snapshots,
)
from app.modules.accounts.schemas import (
    AccountCodexAuthStatus,
    AccountLiveQuotaDebug,
    AccountLiveQuotaDebugSample,
    AccountLiveQuotaDebugWindow,
)


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


@pytest.fixture(autouse=True)
def _clear_terminated_cli_session_snapshot_cache() -> None:
    _terminated_cli_session_snapshot_cache.clear()
    yield
    _terminated_cli_session_snapshot_cache.clear()


def _make_account(
    account_id: str,
    email: str,
    *,
    chatgpt_account_id: str | None = None,
) -> Account:
    encryptor = TokenEncryptor()
    return Account(
        id=account_id,
        chatgpt_account_id=chatgpt_account_id or f"chatgpt-{account_id}",
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


def test_apply_local_live_usage_overrides_ignores_process_sessions_from_legacy_id_alias_bucket(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Legacy rows can carry a stale persisted account.id that points to a
    # multi-snapshot bucket (same ChatGPT account id, multiple emails).
    # Session attribution must follow the account's canonical email snapshot,
    # not whatever appears in the stale id bucket.
    account = _make_account(
        "legacy-id",
        "zeus@example.com",
        chatgpt_account_id="chatgpt-shared",
    )
    canonical_account_id = generate_unique_account_id(
        "chatgpt-shared",
        "zeus@example.com",
    )
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            "legacy-id": ["viktor@example.com", "zeus@example.com"],
            canonical_account_id: ["zeus@example.com"],
        },
        active_snapshot_name="viktor@example.com",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="zeus@example.com",
            active_snapshot_name="viktor@example.com",
            is_active_snapshot=False,
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
        lambda: {"viktor@example.com": 4},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
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
    assert codex_auth_by_account[account.id].has_live_session is False
    assert codex_session_counts_by_account[account.id] == 0


def test_apply_local_live_usage_overrides_matches_session_presence_with_expected_email_snapshot_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "csoves@edixai.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["admin@recodee.com"]},
        active_snapshot_name="admin@recodee.com",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="admin@recodee.com",
            active_snapshot_name="admin@recodee.com",
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
        lambda: {"csoves@edixai.com": 1},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 1


def test_apply_local_live_usage_overrides_matches_process_sessions_case_insensitively(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "csoves@edixai.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["Csoves@Edixai.com"]},
        active_snapshot_name="Csoves@Edixai.com",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="Csoves@Edixai.com",
            active_snapshot_name="Csoves@Edixai.com",
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
        lambda: {"csoves@edixai.com": 1},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 1


def test_apply_local_live_usage_overrides_includes_account_owned_snapshot_aliases_for_presence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account(
        generate_unique_account_id("chatgpt-shared", "admin@recodee.com"),
        "admin@recodee.com",
        chatgpt_account_id="chatgpt-shared",
    )
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            account.id: ["admin@recodee.com", "csoves@edixai.com"],
        },
        active_snapshot_name="admin@recodee.com",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="admin@recodee.com",
            active_snapshot_name="admin@recodee.com",
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
        lambda: {"csoves@edixai.com": 2},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=[account],
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 2


def test_apply_local_live_usage_overrides_preserves_runtime_session_count_without_process_visibility(
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


def test_apply_local_live_usage_overrides_suppresses_stale_live_usage_after_recent_termination(
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
    now = datetime.now(timezone.utc)
    remember_terminated_cli_session_snapshots(["snap-a"], observed_at=now)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "snap-a": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=25.0, reset_at=111, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=40.0, reset_at=222, window_minutes=10_080),
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
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
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
    assert codex_auth_by_account[account.id].has_live_session is False
    assert codex_session_counts_by_account[account.id] == 0


def test_apply_local_live_usage_overrides_ignores_runtime_session_count_with_process_visibility(
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
        lambda: {"other-snapshot": 1},
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
    assert codex_auth_by_account[account.id].has_live_session is False
    assert codex_session_counts_by_account[account.id] == 0


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

    assert codex_session_counts_by_account[account_a.id] == 2
    assert codex_session_counts_by_account[account_b.id] == 0
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is False


def test_apply_local_live_usage_overrides_uses_mixed_default_session_fallback_without_process_visibility(
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
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=88.0,
            reset_at=1_900_100,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=21.0,
            reset_at=1_900_900,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=77.0,
            reset_at=1_903_700,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=15.0,
            reset_at=1_904_500,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

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
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=56.0, reset_at=1_900_500, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=46.0, reset_at=1_904_000, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "snap-a": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now - timedelta(seconds=10),
                    primary=LocalUsageWindow(used_percent=86.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=74.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now - timedelta(seconds=8),
                    primary=LocalUsageWindow(used_percent=23.0, reset_at=1_900_900, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=16.0, reset_at=1_904_500, window_minutes=10_080),
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
        primary_usage=dict(baseline_primary),
        secondary_usage=dict(baseline_secondary),
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    assert codex_session_counts_by_account[account_a.id] == 1
    assert codex_session_counts_by_account[account_b.id] == 1
    assert codex_auth_by_account[account_a.id].has_live_session is True
    assert codex_auth_by_account[account_b.id].has_live_session is True


def test_apply_local_live_usage_overrides_skips_mixed_default_session_fallback_with_process_visibility(
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
    now = datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc)

    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=88.0,
            reset_at=1_900_100,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=21.0,
            reset_at=1_900_900,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=77.0,
            reset_at=1_903_700,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=15.0,
            reset_at=1_904_500,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

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
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=56.0, reset_at=1_900_500, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=46.0, reset_at=1_904_000, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "snap-a": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now - timedelta(seconds=10),
                    primary=LocalUsageWindow(used_percent=86.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=74.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now - timedelta(seconds=8),
                    primary=LocalUsageWindow(used_percent=23.0, reset_at=1_900_900, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=16.0, reset_at=1_904_500, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"snap-a": 2},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=dict(baseline_primary),
        secondary_usage=dict(baseline_secondary),
        codex_live_session_counts_by_account=codex_session_counts_by_account,
    )

    # Process-level visibility is primary; mixed default-scope fingerprint
    # fallback must not create inferred sessions for other accounts.
    assert codex_session_counts_by_account[account_a.id] == 2
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


def test_fallback_mapping_does_not_assign_ambiguous_fingerprint_samples() -> None:
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

    assert codex_session_counts_by_account == {account_a.id: 0, account_b.id: 0}
    assert codex_auth_by_account[account_a.id].has_live_session is False
    assert codex_auth_by_account[account_b.id].has_live_session is False
    assert primary_usage[account_a.id].used_percent == baseline_primary[account_a.id].used_percent
    assert secondary_usage[account_a.id].used_percent == baseline_secondary[account_a.id].used_percent
    assert primary_usage[account_b.id].used_percent == baseline_primary[account_b.id].used_percent
    assert secondary_usage[account_b.id].used_percent == baseline_secondary[account_b.id].used_percent


def test_fallback_mapping_distributes_low_confidence_fingerprint_samples_deterministically() -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    accounts = [account_a, account_b]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account_a.id: ["snap-a"], account_b.id: ["snap-b"]},
        active_snapshot_name="snap-b",
    )
    codex_auth_by_account = {
        account_a.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-a",
            active_snapshot_name="snap-b",
            is_active_snapshot=False,
            has_live_session=False,
        ),
        account_b.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-b",
            active_snapshot_name="snap-b",
            is_active_snapshot=True,
            has_live_session=False,
        ),
    }

    shared_primary_reset = 1_210_100
    shared_secondary_reset = 1_213_700
    baseline_primary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="primary", used_percent=40.0, reset_at=shared_primary_reset, window_minutes=300),
        account_b.id: _usage_entry(account_id=account_b.id, window="primary", used_percent=42.0, reset_at=shared_primary_reset, window_minutes=300),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(account_id=account_a.id, window="secondary", used_percent=40.0, reset_at=shared_secondary_reset, window_minutes=10_080),
        account_b.id: _usage_entry(account_id=account_b.id, window="secondary", used_percent=42.0, reset_at=shared_secondary_reset, window_minutes=10_080),
    }
    primary_usage = dict(baseline_primary)
    secondary_usage = dict(baseline_secondary)
    codex_session_counts_by_account = {account_a.id: 0, account_b.id: 0}

    _apply_local_default_session_fingerprint_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        live_usage_by_snapshot={
            "snap-b": LocalCodexLiveUsage(
                recorded_at=datetime(2026, 4, 3, tzinfo=timezone.utc),
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=50.0, reset_at=1_210_500, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=50.0, reset_at=1_214_100, window_minutes=10_080),
            )
        },
        live_usage_samples_by_snapshot={
            "snap-b": [
                LocalCodexLiveUsageSample(
                    source="rollout-low-confidence-active-a.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=40.9, reset_at=shared_primary_reset, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=40.9, reset_at=shared_secondary_reset, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-low-confidence-active-b.jsonl",
                    recorded_at=datetime(2026, 4, 3, 12, 1, tzinfo=timezone.utc),
                    primary=LocalUsageWindow(used_percent=41.9, reset_at=shared_primary_reset, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=41.9, reset_at=shared_secondary_reset, window_minutes=10_080),
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

    assert codex_session_counts_by_account == {account_a.id: 0, account_b.id: 0}
    assert codex_auth_by_account[account_a.id].has_live_session is False
    assert codex_auth_by_account[account_b.id].has_live_session is False
    assert primary_usage[account_a.id].used_percent == baseline_primary[account_a.id].used_percent
    assert secondary_usage[account_a.id].used_percent == baseline_secondary[account_a.id].used_percent
    assert primary_usage[account_b.id].used_percent == baseline_primary[account_b.id].used_percent
    assert secondary_usage[account_b.id].used_percent == baseline_secondary[account_b.id].used_percent


def test_default_scope_debug_assignment_keeps_source_owner_stable_across_active_snapshot_switches() -> None:
    csoves = _make_account("acc-csoves", "csoves@example.com")
    odin = _make_account("acc-odin", "odin@example.com")
    accounts = [csoves, odin]
    baseline_primary: dict[str, UsageHistory] = {}
    baseline_secondary: dict[str, UsageHistory] = {}
    sample_source = "/tmp/rollout-stable-owner.jsonl"
    first_seen = datetime(2026, 4, 4, 18, 0, tzinfo=timezone.utc)

    by_account_first, confident_first, hints_first = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={csoves.id: ["csoves"], odin.id: ["odin"]},
            active_snapshot_name="csoves",
        ),
        codex_auth_by_account={
            csoves.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="csoves",
                active_snapshot_name="csoves",
                is_active_snapshot=True,
                has_live_session=False,
            ),
            odin.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="odin",
                active_snapshot_name="csoves",
                is_active_snapshot=False,
                has_live_session=False,
            ),
        },
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        live_usage_samples_by_snapshot={
            "csoves": [
                LocalCodexLiveUsageSample(
                    source=sample_source,
                    recorded_at=first_seen,
                    primary=LocalUsageWindow(
                        used_percent=67.0,
                        reset_at=1_761_000_000,
                        window_minutes=300,
                    ),
                    secondary=LocalUsageWindow(
                        used_percent=43.0,
                        reset_at=1_761_600_000,
                        window_minutes=10_080,
                    ),
                    stale=False,
                )
            ]
        },
        should_defer_active_snapshot_usage=True,
    )

    assert confident_first == {}
    assert hints_first == {}
    assert by_account_first == {}

    by_account_second, confident_second, hints_second = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={csoves.id: ["csoves"], odin.id: ["odin"]},
            active_snapshot_name="odin",
        ),
        codex_auth_by_account={
            csoves.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="csoves",
                active_snapshot_name="odin",
                is_active_snapshot=False,
                has_live_session=False,
            ),
            odin.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="odin",
                active_snapshot_name="odin",
                is_active_snapshot=True,
                has_live_session=False,
            ),
        },
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        live_usage_samples_by_snapshot={
            "odin": [
                LocalCodexLiveUsageSample(
                    source=sample_source,
                    recorded_at=first_seen + timedelta(seconds=30),
                    primary=LocalUsageWindow(
                        used_percent=66.0,
                        reset_at=1_761_000_000,
                        window_minutes=300,
                    ),
                    secondary=LocalUsageWindow(
                        used_percent=42.0,
                        reset_at=1_761_600_000,
                        window_minutes=10_080,
                    ),
                    stale=False,
                )
            ]
        },
        should_defer_active_snapshot_usage=True,
    )

    assert confident_second == {}
    assert hints_second == {csoves.id: 1}
    assert csoves.id in by_account_second
    assert odin.id not in by_account_second
    assert by_account_second[csoves.id][0].source == sample_source


def test_default_scope_debug_assignment_keeps_cached_owner_even_without_snapshot() -> None:
    old_owner = _make_account("acc-old", "old@example.com")
    old_owner.status = AccountStatus.DEACTIVATED
    active = _make_account("acc-active", "active@example.com")
    accounts = [old_owner, active]
    sample_source = "/tmp/rollout-cached-owner.jsonl"
    now = datetime(2026, 4, 4, 23, 10, tzinfo=timezone.utc)

    # First pass seeds sticky ownership for the old account source.
    _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
            active_snapshot_name="old",
        ),
        codex_auth_by_account={
            old_owner.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="old",
                active_snapshot_name="old",
                is_active_snapshot=True,
                has_live_session=False,
            ),
            active.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="active",
                active_snapshot_name="old",
                is_active_snapshot=False,
                has_live_session=False,
            ),
        },
        baseline_primary_usage={},
        baseline_secondary_usage={},
        live_usage_samples_by_snapshot={
            "old": [
                LocalCodexLiveUsageSample(
                    source=sample_source,
                    recorded_at=now,
                    primary=LocalUsageWindow(
                        used_percent=74.0,
                        reset_at=1_761_210_000,
                        window_minutes=300,
                    ),
                    secondary=LocalUsageWindow(
                        used_percent=41.0,
                        reset_at=1_761_216_000,
                        window_minutes=10_080,
                    ),
                    stale=False,
                )
            ]
        },
        should_defer_active_snapshot_usage=True,
    )

    by_account, _, hints = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={old_owner.id: [], active.id: ["active"]},
            active_snapshot_name="active",
        ),
        codex_auth_by_account={
            old_owner.id: AccountCodexAuthStatus(
                has_snapshot=False,
                snapshot_name=None,
                active_snapshot_name="active",
                is_active_snapshot=False,
                has_live_session=False,
            ),
            active.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="active",
                active_snapshot_name="active",
                is_active_snapshot=True,
                has_live_session=False,
            ),
        },
        baseline_primary_usage={},
        baseline_secondary_usage={},
        live_usage_samples_by_snapshot={
            "active": [
                LocalCodexLiveUsageSample(
                    source=sample_source,
                    recorded_at=now + timedelta(seconds=30),
                    primary=LocalUsageWindow(
                        used_percent=74.0,
                        reset_at=1_761_210_000,
                        window_minutes=300,
                    ),
                    secondary=LocalUsageWindow(
                        used_percent=41.0,
                        reset_at=1_761_216_000,
                        window_minutes=10_080,
                    ),
                    stale=False,
                )
            ]
        },
        should_defer_active_snapshot_usage=True,
    )

    assert hints == {old_owner.id: 1}
    assert old_owner.id in by_account
    assert active.id not in by_account
    assert by_account[old_owner.id][0].source == sample_source


def test_default_scope_debug_assignment_does_not_prime_mixed_unattributed_samples() -> None:
    old_owner = _make_account("acc-old", "old@example.com")
    active = _make_account("acc-active", "active@example.com")
    accounts = [old_owner, active]

    # Seed sticky ownership for an existing session source.
    seeded_source = "/tmp/rollout-2026-04-04T23-20-00-seeded.jsonl"
    seeded_at = datetime(2026, 4, 4, 23, 20, tzinfo=timezone.utc)
    seeded_by_account, _, seeded_hints = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
            active_snapshot_name="old",
        ),
        codex_auth_by_account={
            old_owner.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="old",
                active_snapshot_name="old",
                is_active_snapshot=True,
                has_live_session=False,
            ),
            active.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="active",
                active_snapshot_name="old",
                is_active_snapshot=False,
                has_live_session=False,
            ),
        },
        baseline_primary_usage={},
        baseline_secondary_usage={},
        live_usage_samples_by_snapshot={
            "old": [
                LocalCodexLiveUsageSample(
                    source=seeded_source,
                    recorded_at=seeded_at,
                    primary=LocalUsageWindow(
                        used_percent=62.0,
                        reset_at=1_761_111_100,
                        window_minutes=300,
                    ),
                    secondary=LocalUsageWindow(
                        used_percent=40.0,
                        reset_at=1_761_117_100,
                        window_minutes=10_080,
                    ),
                    stale=False,
                )
            ]
        },
        should_defer_active_snapshot_usage=True,
    )

    assert seeded_by_account == {}
    assert seeded_hints == {}

    older_unattributed = "/tmp/rollout-2026-04-04T23-24-00-older.jsonl"
    newest_unattributed = "/tmp/rollout-2026-04-04T23-25-00-newest.jsonl"
    second_pass_samples = {
        "active": [
            LocalCodexLiveUsageSample(
                source=seeded_source,
                recorded_at=seeded_at + timedelta(minutes=4),
                primary=LocalUsageWindow(
                    used_percent=61.5,
                    reset_at=1_761_111_100,
                    window_minutes=300,
                ),
                secondary=LocalUsageWindow(
                    used_percent=39.5,
                    reset_at=1_761_117_100,
                    window_minutes=10_080,
                ),
                stale=False,
            ),
            LocalCodexLiveUsageSample(
                source=older_unattributed,
                recorded_at=seeded_at + timedelta(minutes=4, seconds=30),
                primary=LocalUsageWindow(
                    used_percent=73.0,
                    reset_at=1_761_130_000,
                    window_minutes=300,
                ),
                secondary=LocalUsageWindow(
                    used_percent=55.0,
                    reset_at=1_761_136_000,
                    window_minutes=10_080,
                ),
                stale=False,
            ),
            LocalCodexLiveUsageSample(
                source=newest_unattributed,
                recorded_at=seeded_at + timedelta(minutes=5),
                primary=LocalUsageWindow(
                    used_percent=74.0,
                    reset_at=1_761_140_000,
                    window_minutes=300,
                ),
                secondary=LocalUsageWindow(
                    used_percent=56.0,
                    reset_at=1_761_146_000,
                    window_minutes=10_080,
                ),
                stale=False,
            ),
        ]
    }
    for _ in range(2):
        _build_default_sample_debug_overrides(
            accounts=accounts,
            snapshot_index=CodexAuthSnapshotIndex(
                snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
                active_snapshot_name="active",
            ),
            codex_auth_by_account={
                old_owner.id: AccountCodexAuthStatus(
                    has_snapshot=True,
                    snapshot_name="old",
                    active_snapshot_name="active",
                    is_active_snapshot=False,
                    has_live_session=False,
                ),
                active.id: AccountCodexAuthStatus(
                    has_snapshot=True,
                    snapshot_name="active",
                    active_snapshot_name="active",
                    is_active_snapshot=True,
                    has_live_session=False,
                ),
            },
            baseline_primary_usage={},
            baseline_secondary_usage={},
            live_usage_samples_by_snapshot=second_pass_samples,
            should_defer_active_snapshot_usage=True,
        )

    by_account, _, hints = _build_default_sample_debug_overrides(
        accounts=accounts,
        snapshot_index=CodexAuthSnapshotIndex(
            snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
            active_snapshot_name="active",
        ),
        codex_auth_by_account={
            old_owner.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="old",
                active_snapshot_name="active",
                is_active_snapshot=False,
                has_live_session=False,
            ),
            active.id: AccountCodexAuthStatus(
                has_snapshot=True,
                snapshot_name="active",
                active_snapshot_name="active",
                is_active_snapshot=True,
                has_live_session=False,
            ),
        },
        baseline_primary_usage={},
        baseline_secondary_usage={},
        live_usage_samples_by_snapshot=second_pass_samples,
        should_defer_active_snapshot_usage=True,
    )

    assert hints == {old_owner.id: 1}
    assert [sample.source for sample in by_account[old_owner.id]] == [seeded_source]
    assert active.id not in by_account


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


def test_global_assignment_can_disable_low_confidence_fallback_assignments() -> None:
    account_a = _make_account("acc-a", "a@example.com")
    account_b = _make_account("acc-b", "b@example.com")
    baseline_primary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="primary",
            used_percent=30.0,
            reset_at=1_600_000,
            window_minutes=300,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="primary",
            used_percent=35.0,
            reset_at=1_600_000,
            window_minutes=300,
        ),
    }
    baseline_secondary = {
        account_a.id: _usage_entry(
            account_id=account_a.id,
            window="secondary",
            used_percent=30.0,
            reset_at=1_603_600,
            window_minutes=10_080,
        ),
        account_b.id: _usage_entry(
            account_id=account_b.id,
            window="secondary",
            used_percent=35.0,
            reset_at=1_603_600,
            window_minutes=10_080,
        ),
    }
    sample = _live_sample(
        recorded_at=datetime(2026, 4, 3, 12, 0, tzinfo=timezone.utc),
        primary_used=32.0,
        secondary_used=32.0,
        primary_reset=1_600_000,
        secondary_reset=1_603_600,
    )

    default_assignments = _resolve_sample_account_assignments(
        samples=[sample],
        accounts=[account_a, account_b],
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
    )
    strict_assignments = _resolve_sample_account_assignments(
        samples=[sample],
        accounts=[account_a, account_b],
        baseline_primary_usage=baseline_primary,
        baseline_secondary_usage=baseline_secondary,
        allow_low_confidence_assignments=False,
    )

    assert 0 in default_assignments
    assert default_assignments[0].confidence == "low"
    assert strict_assignments == {}


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
    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 1
    assert primary_usage[account.id].used_percent == pytest.approx(11.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(22.0)


def test_apply_local_live_usage_overrides_prefers_selected_snapshot_even_if_index_bucket_differs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "codexina@nagyviktor.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["codexina"]},
        active_snapshot_name="codexinaforever",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="codexinaforever",
            active_snapshot_name="codexinaforever",
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
            "codexina": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=99.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=88.0, reset_at=1_903_700, window_minutes=10_080),
            ),
            "codexinaforever": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=12.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=23.0, reset_at=1_903_700, window_minutes=10_080),
            ),
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "codexina": [
                LocalCodexLiveUsageSample(
                    source="rollout-codexina.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=99.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=88.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                )
            ],
            "codexinaforever": [
                LocalCodexLiveUsageSample(
                    source="rollout-codexinaforever.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=12.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=23.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                )
            ],
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"codexina": 1, "codexinaforever": 1},
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
    assert debug.snapshots_considered == ["codexinaforever"]
    assert [sample.snapshot_name for sample in debug.raw_samples] == ["codexinaforever"]
    assert primary_usage[account.id].used_percent == pytest.approx(12.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(23.0)


def test_apply_local_live_usage_overrides_preserves_live_session_signal_for_alias_snapshot_process_counts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-a", "codexina@edixai.com")
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["codexina", "codexinaedix", "csoves"]},
        active_snapshot_name="codexinaedix",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="codexinaedix",
            active_snapshot_name="codexinaedix",
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
            "codexina": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=88.0, reset_at=1_900_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=49.0, reset_at=1_903_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "codexina": [
                LocalCodexLiveUsageSample(
                    source="rollout-codexina.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=88.0, reset_at=1_900_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=49.0, reset_at=1_903_700, window_minutes=10_080),
                    stale=False,
                )
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"codexina": 1},
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
    assert debug.snapshots_considered == ["codexina"]
    assert [sample.snapshot_name for sample in debug.raw_samples] == ["codexina"]
    assert debug.merged is not None
    assert debug.override_applied is True
    assert debug.override_reason == "applied_live_usage_windows"
    assert codex_auth_by_account[account.id].has_live_session is True
    assert codex_session_counts_by_account[account.id] == 1
    assert primary_usage[account.id].used_percent == pytest.approx(88.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(49.0)


def test_apply_local_live_usage_overrides_keeps_baseline_for_new_default_scope_sample_without_confident_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active_account = _make_account("acc-z", "active@example.com")
    other_account = _make_account("acc-a", "other@example.com")
    accounts = [active_account, other_account]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            active_account.id: ["snap-z", "active-now"],
            other_account.id: ["snap-a"],
        },
        active_snapshot_name="active-now",
    )
    codex_auth_by_account = {
        active_account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-z",
            active_snapshot_name="active-now",
            is_active_snapshot=False,
            has_live_session=False,
        ),
        other_account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="snap-a",
            active_snapshot_name="active-now",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        active_account.id: _usage_entry(
            account_id=active_account.id,
            window="primary",
            used_percent=64.0,
            reset_at=2_100_100,
            window_minutes=300,
        ),
        other_account.id: _usage_entry(
            account_id=other_account.id,
            window="primary",
            used_percent=62.0,
            reset_at=2_100_100,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        active_account.id: _usage_entry(
            account_id=active_account.id,
            window="secondary",
            used_percent=42.0,
            reset_at=2_103_700,
            window_minutes=10_080,
        ),
        other_account.id: _usage_entry(
            account_id=other_account.id,
            window="secondary",
            used_percent=44.0,
            reset_at=2_103_700,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {active_account.id: 0, other_account.id: 0}
    debug_by_account: dict[str, AccountLiveQuotaDebug] = {}
    now = datetime(2026, 4, 4, 18, 10, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "active-now": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=64.0, reset_at=2_100_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=42.0, reset_at=2_103_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "active-now": [
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T18-10-18-new.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=1.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=25.0, reset_at=None, window_minutes=10_080),
                    stale=False,
                )
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
        live_quota_debug_by_account=debug_by_account,
    )

    assert primary_usage[active_account.id].used_percent == pytest.approx(64.0)
    assert secondary_usage[active_account.id].used_percent == pytest.approx(42.0)
    assert primary_usage[other_account.id].used_percent == pytest.approx(62.0)
    assert secondary_usage[other_account.id].used_percent == pytest.approx(44.0)
    assert active_account.id in debug_by_account
    assert debug_by_account[active_account.id].raw_samples == []
    assert debug_by_account[active_account.id].override_reason == "no_live_telemetry"


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
    assert switched_auth_by_account[cica.id].has_live_session is True
    assert switched_auth_by_account[amodeus.id].has_live_session is True
    assert cica_debug.raw_samples == []
    assert amodeus_debug.raw_samples == []


def test_apply_local_live_usage_overrides_keeps_active_snapshot_idle_when_only_cached_old_session_matches(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    old_owner = _make_account("acc-old", "old@example.com")
    active = _make_account("acc-active", "active@example.com")
    accounts = [old_owner, active]
    now = datetime(2026, 4, 4, 12, 0, tzinfo=timezone.utc)

    seed_snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
        active_snapshot_name="old",
    )
    seed_auth_by_account = {
        old_owner.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="old",
            active_snapshot_name="old",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        active.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="active",
            active_snapshot_name="old",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "old": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=80.0, reset_at=2_600_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=70.0, reset_at=2_603_700, window_minutes=10_080),
            ),
            "active": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=10.0, reset_at=2_600_900, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=20.0, reset_at=2_604_500, window_minutes=10_080),
            ),
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "old": [
                LocalCodexLiveUsageSample(
                    source="rollout-old-owner.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=80.0, reset_at=2_600_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=70.0, reset_at=2_603_700, window_minutes=10_080),
                    stale=False,
                )
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {"old": 1},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_runtime_live_session_counts_by_snapshot",
        lambda: {},
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=seed_snapshot_index,
        codex_auth_by_account=seed_auth_by_account,
        primary_usage={},
        secondary_usage={},
        codex_live_session_counts_by_account={old_owner.id: 0, active.id: 0},
        live_quota_debug_by_account={},
    )

    switched_snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={old_owner.id: ["old"], active.id: ["active"]},
        active_snapshot_name="active",
    )
    switched_auth_by_account = {
        old_owner.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="old",
            active_snapshot_name="active",
            is_active_snapshot=False,
            has_live_session=False,
        ),
        active.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="active",
            active_snapshot_name="active",
            is_active_snapshot=True,
            has_live_session=False,
        ),
    }

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "active": LocalCodexLiveUsage(
                recorded_at=now + timedelta(seconds=5),
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=10.0, reset_at=2_600_900, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=20.0, reset_at=2_604_500, window_minutes=10_080),
            ),
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "active": [
                LocalCodexLiveUsageSample(
                    source="rollout-old-owner.jsonl",
                    recorded_at=now + timedelta(seconds=5),
                    primary=LocalUsageWindow(used_percent=80.0, reset_at=2_600_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=70.0, reset_at=2_603_700, window_minutes=10_080),
                    stale=False,
                )
            ],
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_live_codex_process_session_counts_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.has_recent_active_snapshot_process_fallback",
        lambda: False,
    )

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=switched_snapshot_index,
        codex_auth_by_account=switched_auth_by_account,
        primary_usage={
            old_owner.id: _usage_entry(
                account_id=old_owner.id,
                window="primary",
                used_percent=80.0,
                reset_at=2_600_100,
                window_minutes=300,
            ),
            active.id: _usage_entry(
                account_id=active.id,
                window="primary",
                used_percent=10.0,
                reset_at=2_600_900,
                window_minutes=300,
            ),
        },
        secondary_usage={
            old_owner.id: _usage_entry(
                account_id=old_owner.id,
                window="secondary",
                used_percent=70.0,
                reset_at=2_603_700,
                window_minutes=10_080,
            ),
            active.id: _usage_entry(
                account_id=active.id,
                window="secondary",
                used_percent=20.0,
                reset_at=2_604_500,
                window_minutes=10_080,
            ),
        },
        codex_live_session_counts_by_account={old_owner.id: 0, active.id: 0},
        live_quota_debug_by_account={},
    )

    assert switched_auth_by_account[old_owner.id].has_live_session is True
    assert switched_auth_by_account[active.id].has_live_session is False


def test_apply_local_live_usage_overrides_clears_active_baseline_when_deferred_samples_exist(
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


def test_apply_local_live_usage_overrides_skips_sample_floor_for_ambiguous_deferred_active_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    korona = _make_account("acc-korona", "korona@example.com")
    other = _make_account("acc-other", "other@example.com")
    accounts = [korona, other]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            korona.id: ["korona"],
            other.id: ["other"],
        },
        active_snapshot_name="korona",
    )
    codex_auth_by_account = {
        korona.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="korona",
            active_snapshot_name="korona",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        other.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="other",
            active_snapshot_name="korona",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        korona.id: _usage_entry(
            account_id=korona.id,
            window="primary",
            used_percent=16.0,
            reset_at=4_000_100,
            window_minutes=300,
        ),
        other.id: _usage_entry(
            account_id=other.id,
            window="primary",
            used_percent=5.0,
            reset_at=4_000_900,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        korona.id: _usage_entry(
            account_id=korona.id,
            window="secondary",
            used_percent=90.0,
            reset_at=4_003_700,
            window_minutes=10_080,
        ),
        other.id: _usage_entry(
            account_id=other.id,
            window="secondary",
            used_percent=4.0,
            reset_at=4_004_500,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {korona.id: 0, other.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 16, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "korona": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=16.0, reset_at=4_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=90.0, reset_at=4_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "korona": [
                LocalCodexLiveUsageSample(
                    source="rollout-a.jsonl",
                    recorded_at=now - timedelta(seconds=30),
                    primary=LocalUsageWindow(used_percent=1.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=0.0, reset_at=None, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="rollout-b.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=10.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=1.0, reset_at=None, window_minutes=10_080),
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

    assert primary_usage[korona.id].used_percent == pytest.approx(16.0)
    assert secondary_usage[korona.id].used_percent == pytest.approx(90.0)
    assert len(candidates) == 0
    debug = debug_by_account[korona.id]
    assert debug.override_applied is False
    assert debug.override_reason == "deferred_active_snapshot_mixed_default_sessions"
    assert debug.merged.primary is not None
    assert debug.merged.secondary is not None
    assert debug.merged.primary.remaining_percent == pytest.approx(84.0)
    assert debug.merged.secondary.remaining_percent == pytest.approx(10.0)


def test_apply_local_live_usage_overrides_skips_deferred_sample_floor_when_runtime_session_exists(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    active = _make_account("acc-active", "active@example.com")
    other = _make_account("acc-other", "other@example.com")
    accounts = [active, other]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={active.id: ["active"], other.id: ["other"]},
        active_snapshot_name="active",
    )
    codex_auth_by_account = {
        active.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="active",
            active_snapshot_name="active",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        other.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="other",
            active_snapshot_name="active",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        active.id: _usage_entry(
            account_id=active.id,
            window="primary",
            used_percent=12.0,
            reset_at=6_000_100,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        active.id: _usage_entry(
            account_id=active.id,
            window="secondary",
            used_percent=12.0,
            reset_at=6_003_700,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {active.id: 0, other.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 16, 20, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "active": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=LocalUsageWindow(used_percent=36.0, reset_at=6_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=4.0, reset_at=6_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "active": [
                LocalCodexLiveUsageSample(
                    source="rollout-older.jsonl",
                    recorded_at=now - timedelta(seconds=3),
                    primary=LocalUsageWindow(used_percent=19.0, reset_at=6_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=2.0, reset_at=6_003_700, window_minutes=10_080),
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
        lambda: {"active": 1},
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

    assert codex_session_counts_by_account[active.id] == 1
    assert primary_usage[active.id].used_percent == pytest.approx(36.0)
    assert secondary_usage[active.id].used_percent == pytest.approx(4.0)
    assert len(candidates) == 2
    debug = debug_by_account[active.id]
    assert debug.override_reason == "applied_live_usage_windows"


def test_apply_local_live_usage_overrides_keeps_baseline_for_ambiguous_deferred_active_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-newest", "newest@example.com")
    other = _make_account("acc-other", "other@example.com")
    accounts = [account, other]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["newest"], other.id: ["other"]},
        active_snapshot_name="newest",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="newest",
            active_snapshot_name="newest",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        other.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="other",
            active_snapshot_name="newest",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="primary",
            used_percent=55.0,
            reset_at=5_000_100,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="secondary",
            used_percent=55.0,
            reset_at=5_003_700,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {account.id: 0, other.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 16, 0, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "newest": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=55.0, reset_at=5_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=55.0, reset_at=5_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "newest": [
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T16-19-21-older.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=23.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=53.0, reset_at=None, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T16-22-05-newest.jsonl",
                    recorded_at=now - timedelta(seconds=2),
                    primary=LocalUsageWindow(used_percent=39.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=5.0, reset_at=None, window_minutes=10_080),
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

    assert primary_usage[account.id].used_percent == pytest.approx(55.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(55.0)
    # In strict deferred mode, unresolved mixed default-scope samples should
    # not auto-mark the active snapshot as live.
    assert codex_auth_by_account[account.id].has_live_session is False
    assert codex_auth_by_account[other.id].has_live_session is False
    debug = debug_by_account[account.id]
    assert debug.override_applied is False
    assert debug.override_reason == "deferred_active_snapshot_mixed_default_sessions"


def test_apply_local_live_usage_overrides_keeps_baseline_for_scoped_deferred_debug_samples_without_confident_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-bia", "bia@example.com")
    other = _make_account("acc-odin", "odin@example.com")
    accounts = [account, other]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["bia"], other.id: ["odin"]},
        active_snapshot_name="bia",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="bia",
            active_snapshot_name="bia",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        other.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="odin",
            active_snapshot_name="bia",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="primary",
            used_percent=50.0,
            reset_at=7_000_100,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="secondary",
            used_percent=44.0,
            reset_at=7_003_700,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {account.id: 0, other.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 17, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "bia": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=50.0, reset_at=7_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=44.0, reset_at=7_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "bia": [
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T17-30-00-mixed.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=50.0, reset_at=7_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=44.0, reset_at=7_003_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T17-28-59-bia.jsonl",
                    recorded_at=now - timedelta(seconds=61),
                    primary=LocalUsageWindow(used_percent=84.0, reset_at=7_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=60.0, reset_at=7_003_700, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides._build_default_sample_debug_overrides",
        lambda **_: (
            {
                account.id: [
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T17-28-59-bia.jsonl",
                        snapshot_name="bia",
                        recorded_at=now - timedelta(seconds=61),
                        stale=False,
                        primary=AccountLiveQuotaDebugWindow(
                            used_percent=84.0,
                            remaining_percent=16.0,
                            reset_at=7_000_100,
                            window_minutes=300,
                        ),
                        secondary=AccountLiveQuotaDebugWindow(
                            used_percent=60.0,
                            remaining_percent=40.0,
                            reset_at=7_003_700,
                            window_minutes=10_080,
                        ),
                    )
                ]
            },
            {},
            {},
        ),
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

    assert primary_usage[account.id].used_percent == pytest.approx(50.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(44.0)
    debug = debug_by_account[account.id]
    assert debug.override_reason == "deferred_active_snapshot_mixed_default_sessions"
    assert debug.merged is not None
    assert debug.merged.primary is not None
    assert debug.merged.secondary is not None
    assert debug.merged.primary.remaining_percent == pytest.approx(50.0)
    assert debug.merged.secondary.remaining_percent == pytest.approx(56.0)


def test_apply_local_live_usage_overrides_keeps_baseline_for_multiple_scoped_deferred_debug_samples_without_confident_ownership(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-bia", "bia@example.com")
    other = _make_account("acc-odin", "odin@example.com")
    accounts = [account, other]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["bia"], other.id: ["odin"]},
        active_snapshot_name="bia",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="bia",
            active_snapshot_name="bia",
            is_active_snapshot=True,
            has_live_session=False,
        ),
        other.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="odin",
            active_snapshot_name="bia",
            is_active_snapshot=False,
            has_live_session=False,
        ),
    }
    primary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="primary",
            used_percent=50.0,
            reset_at=8_000_100,
            window_minutes=300,
        ),
    }
    secondary_usage = {
        account.id: _usage_entry(
            account_id=account.id,
            window="secondary",
            used_percent=44.0,
            reset_at=8_003_700,
            window_minutes=10_080,
        ),
    }
    codex_session_counts_by_account = {account.id: 0, other.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 17, 40, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "bia": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=2,
                primary=LocalUsageWindow(used_percent=50.0, reset_at=8_000_100, window_minutes=300),
                secondary=LocalUsageWindow(used_percent=44.0, reset_at=8_003_700, window_minutes=10_080),
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "bia": [
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T17-40-00.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=84.0, reset_at=8_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=60.0, reset_at=8_003_700, window_minutes=10_080),
                    stale=False,
                ),
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T17-39-00.jsonl",
                    recorded_at=now - timedelta(seconds=45),
                    primary=LocalUsageWindow(used_percent=50.0, reset_at=8_000_100, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=44.0, reset_at=8_003_700, window_minutes=10_080),
                    stale=False,
                ),
            ]
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides._build_default_sample_debug_overrides",
        lambda **_: (
            {
                account.id: [
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T17-40-00.jsonl",
                        snapshot_name="bia",
                        recorded_at=now,
                        stale=False,
                        primary=AccountLiveQuotaDebugWindow(
                            used_percent=84.0,
                            remaining_percent=16.0,
                            reset_at=8_000_100,
                            window_minutes=300,
                        ),
                        secondary=AccountLiveQuotaDebugWindow(
                            used_percent=60.0,
                            remaining_percent=40.0,
                            reset_at=8_003_700,
                            window_minutes=10_080,
                        ),
                    ),
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T17-39-00.jsonl",
                        snapshot_name="bia",
                        recorded_at=now - timedelta(seconds=45),
                        stale=False,
                        primary=AccountLiveQuotaDebugWindow(
                            used_percent=50.0,
                            remaining_percent=50.0,
                            reset_at=8_000_100,
                            window_minutes=300,
                        ),
                        secondary=AccountLiveQuotaDebugWindow(
                            used_percent=44.0,
                            remaining_percent=56.0,
                            reset_at=8_003_700,
                            window_minutes=10_080,
                        ),
                    ),
                ]
            },
            {},
            {},
        ),
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

    assert primary_usage[account.id].used_percent == pytest.approx(50.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(44.0)
    debug = debug_by_account[account.id]
    assert debug.override_reason == "deferred_active_snapshot_mixed_default_sessions"
    assert debug.merged is not None
    assert debug.merged.primary is not None
    assert debug.merged.secondary is not None
    assert debug.merged.primary.remaining_percent == pytest.approx(50.0)
    assert debug.merged.secondary.remaining_percent == pytest.approx(56.0)


def test_apply_local_live_usage_overrides_hides_presence_only_debug_samples(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-single", "single@example.com")
    accounts = [account]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["single"]},
        active_snapshot_name="single",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="single",
            active_snapshot_name="single",
            is_active_snapshot=True,
            has_live_session=False,
        )
    }
    primary_usage = {}
    secondary_usage = {}
    session_counts = {account.id: 0}
    debug_by_account = {}
    now = datetime(2026, 4, 4, 16, 30, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {
            "single": LocalCodexLiveUsage(
                recorded_at=now,
                active_session_count=1,
                primary=None,
                secondary=None,
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "single": [
                LocalCodexLiveUsageSample(
                    source="rollout-presence-only.jsonl",
                    recorded_at=now,
                    primary=None,
                    secondary=None,
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

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=session_counts,
        live_quota_debug_by_account=debug_by_account,
    )

    debug = debug_by_account[account.id]
    assert debug.override_reason == "live_session_without_windows"
    assert debug.raw_samples == []
    assert debug.merged is None


def test_apply_local_live_usage_overrides_applies_sample_override_without_live_telemetry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    account = _make_account("acc-odin", "odin@example.com")
    accounts = [account]
    snapshot_index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={account.id: ["odin"]},
        active_snapshot_name="odin",
    )
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="odin",
            active_snapshot_name="odin",
            is_active_snapshot=True,
            has_live_session=False,
        )
    }
    primary_usage: dict[str, UsageHistory] = {}
    secondary_usage: dict[str, UsageHistory] = {}
    session_counts = {account.id: 0}
    debug_by_account: dict[str, AccountLiveQuotaDebug] = {}
    now = datetime(2026, 4, 4, 17, 17, tzinfo=timezone.utc)

    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_by_snapshot",
        lambda: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.live_usage_overrides.read_local_codex_live_usage_samples_by_snapshot",
        lambda: {
            "odin": [
                LocalCodexLiveUsageSample(
                    source="/tmp/rollout-2026-04-04T17-17-06-019d5911-b523-76d1-b6b8-08959f6c44f1.jsonl",
                    recorded_at=now,
                    primary=LocalUsageWindow(used_percent=1.0, reset_at=None, window_minutes=300),
                    secondary=LocalUsageWindow(used_percent=38.0, reset_at=None, window_minutes=10_080),
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

    apply_local_live_usage_overrides(
        accounts=accounts,
        snapshot_index=snapshot_index,
        codex_auth_by_account=codex_auth_by_account,
        primary_usage=primary_usage,
        secondary_usage=secondary_usage,
        codex_live_session_counts_by_account=session_counts,
        live_quota_debug_by_account=debug_by_account,
    )

    assert primary_usage[account.id].used_percent == pytest.approx(1.0)
    assert secondary_usage[account.id].used_percent == pytest.approx(38.0)
    assert codex_auth_by_account[account.id].has_live_session is False
    assert session_counts[account.id] == 0
    debug = debug_by_account[account.id]
    assert debug.override_applied is True
    assert debug.override_reason in {
        "no_live_telemetry_confident_sample_override",
        "no_live_telemetry_sample_floor_override",
    }
    assert debug.merged is not None
    assert debug.merged.primary is not None
    assert debug.merged.primary.remaining_percent == pytest.approx(99.0)
    assert debug.merged.secondary is not None
    assert debug.merged.secondary.remaining_percent == pytest.approx(62.0)
