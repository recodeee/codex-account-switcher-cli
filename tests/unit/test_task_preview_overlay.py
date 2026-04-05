from __future__ import annotations

from datetime import datetime, timezone

from app.core.crypto import TokenEncryptor
from app.db.models import Account, AccountStatus
from app.modules.accounts.codex_live_usage import (
    LocalCodexProcessSessionAttribution,
    LocalCodexTaskPreview,
)
from app.modules.accounts.live_usage_overrides import remember_terminated_cli_session_snapshots
from app.modules.accounts.schemas import (
    AccountCodexAuthStatus,
    AccountLiveQuotaDebug,
    AccountLiveQuotaDebugSample,
)
from app.modules.accounts.task_preview_overlay import overlay_live_codex_task_previews


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


def test_overlay_replaces_stale_preview_with_waiting_for_new_task(
    monkeypatch,
) -> None:
    account = _make_account("acc-admin", "admin@edixai.com")
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="admin@edixai.com",
            active_snapshot_name="admin@edixai.com",
            is_active_snapshot=True,
            has_live_session=True,
        )
    }
    codex_current_task_preview_by_account = {
        account.id: "the 2% is basically zero so anything under 5%",
    }
    codex_last_task_preview_by_account: dict[str, str] = {}

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={"admin@edixai.com": 2},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={"admin@edixai.com": [1506551, 1514670]},
            task_preview_by_pid={},
            task_previews_by_pid={},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={},
        now=datetime(2026, 4, 5, tzinfo=timezone.utc),
    )

    assert codex_current_task_preview_by_account[account.id] == "Waiting for new task"
    assert account.id not in codex_last_task_preview_by_account


def test_overlay_prefers_live_process_preview_for_snapshot(monkeypatch) -> None:
    account = _make_account("acc-bia", "bia@edixai.com")
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="bia@edixai.com",
            active_snapshot_name="bia@edixai.com",
            is_active_snapshot=True,
            has_live_session=True,
        )
    }
    codex_current_task_preview_by_account: dict[str, str] = {}
    codex_last_task_preview_by_account: dict[str, str] = {}

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={"bia@edixai.com": 1},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={"bia@edixai.com": [200001]},
            task_preview_by_pid={200001: "Investigate snapshot mapping"},
            task_previews_by_pid={200001: ["Investigate snapshot mapping"]},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={},
        now=datetime(2026, 4, 5, tzinfo=timezone.utc),
    )

    assert codex_current_task_preview_by_account[account.id] == "Investigate snapshot mapping"
    assert account.id not in codex_last_task_preview_by_account


def test_overlay_keeps_waiting_state_and_adds_last_task_preview(monkeypatch) -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    account = _make_account("acc-zeus", "zeus@example.com")
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="zeus",
            active_snapshot_name="zeus",
            is_active_snapshot=True,
            has_live_session=True,
        )
    }
    codex_current_task_preview_by_account: dict[str, str] = {}
    codex_last_task_preview_by_account: dict[str, str] = {}

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {
            "zeus": LocalCodexTaskPreview(
                text="Investigate Zeus quota overlay mapping",
                recorded_at=now,
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={"zeus": 1},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={"zeus": [31001]},
            task_preview_by_pid={},
            task_previews_by_pid={},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={},
        now=now,
    )

    assert codex_current_task_preview_by_account[account.id] == "Waiting for new task"
    assert (
        codex_last_task_preview_by_account[account.id]
        == "Investigate Zeus quota overlay mapping"
    )


def test_overlay_waiting_multi_session_does_not_copy_last_task_from_debug_sample(
    monkeypatch,
) -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    account = _make_account("acc-tokio", "tokio@edixai.com")
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="tokio@edixai.com",
            active_snapshot_name="tokio@edixai.com",
            is_active_snapshot=True,
            has_live_session=True,
        )
    }
    codex_current_task_preview_by_account: dict[str, str] = {}
    codex_last_task_preview_by_account: dict[str, str] = {}

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {
            "019d5a6a-4665-7873-9714-9efb95b24272": LocalCodexTaskPreview(
                text="hide the snapshot name too because that is email",
                recorded_at=now,
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={"tokio@edixai.com": 2},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={"tokio@edixai.com": [393741, 393963]},
            task_preview_by_pid={},
            task_previews_by_pid={},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={
            account.id: AccountLiveQuotaDebug(
                snapshots_considered=["tokio@edixai.com"],
                raw_samples=[
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T21-33-33-019d5a6a-4665-7873-9714-9efb95b24272.jsonl",
                        snapshot_name="tokio@edixai.com",
                        recorded_at=now,
                        stale=False,
                    )
                ],
            )
        },
        now=now,
    )

    assert codex_current_task_preview_by_account[account.id] == "Waiting for new task"
    assert account.id not in codex_last_task_preview_by_account


def test_overlay_waiting_last_task_uses_matching_snapshot_debug_sample_only(monkeypatch) -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    account = _make_account("acc-viktor", "viktor@edixai.com")
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name="viktor@edixai.com",
            active_snapshot_name="viktor@edixai.com",
            is_active_snapshot=True,
            has_live_session=True,
        )
    }
    codex_current_task_preview_by_account: dict[str, str] = {}
    codex_last_task_preview_by_account: dict[str, str] = {}

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {
            "019d5a6a-4665-7873-9714-9efb95b24272": LocalCodexTaskPreview(
                text="hide the snapshot name too because that is email",
                recorded_at=now,
            )
        },
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={"viktor@edixai.com": 1},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={"viktor@edixai.com": [408006]},
            task_preview_by_pid={},
            task_previews_by_pid={},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={
            account.id: AccountLiveQuotaDebug(
                snapshots_considered=["tokio@edixai.com", "viktor@edixai.com"],
                raw_samples=[
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T21-33-33-019d5a6a-4665-7873-9714-9efb95b24272.jsonl",
                        snapshot_name="tokio@edixai.com",
                        recorded_at=now,
                        stale=False,
                    ),
                    AccountLiveQuotaDebugSample(
                        source="/tmp/rollout-2026-04-04T21-33-33-019d5a6a-4665-7873-9714-9efb95b24272.jsonl",
                        snapshot_name="viktor@edixai.com",
                        recorded_at=now,
                        stale=False,
                    ),
                ],
            )
        },
        now=now,
    )

    assert codex_current_task_preview_by_account[account.id] == "Waiting for new task"
    assert (
        codex_last_task_preview_by_account[account.id]
        == "hide the snapshot name too because that is email"
    )


def test_overlay_suppresses_stale_snapshot_preview_after_recent_termination(monkeypatch) -> None:
    now = datetime(2026, 4, 5, tzinfo=timezone.utc)
    account = _make_account("acc-korona", "korona@nagyviktor.com")
    snapshot_name = "korona@nagyviktor.com"
    codex_auth_by_account = {
        account.id: AccountCodexAuthStatus(
            has_snapshot=True,
            snapshot_name=snapshot_name,
            active_snapshot_name="amodeus@nagyviktor.com",
            is_active_snapshot=False,
            has_live_session=False,
        )
    }
    codex_current_task_preview_by_account = {
        account.id: "Waiting for new task",
    }
    codex_last_task_preview_by_account = {
        account.id: "Investigate old sticky session task",
    }

    remember_terminated_cli_session_snapshots([snapshot_name], observed_at=now)

    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_snapshot",
        lambda *, now: {snapshot_name: LocalCodexTaskPreview(text="Waiting for new task", recorded_at=now)},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_local_codex_task_previews_by_session_id",
        lambda *, now: {},
    )
    monkeypatch.setattr(
        "app.modules.accounts.task_preview_overlay.read_live_codex_process_session_attribution",
        lambda: LocalCodexProcessSessionAttribution(
            counts_by_snapshot={},
            unattributed_session_pids=[],
            mapped_session_pids_by_snapshot={},
            task_preview_by_pid={},
            task_previews_by_pid={},
        ),
    )

    overlay_live_codex_task_previews(
        accounts=[account],
        codex_auth_by_account=codex_auth_by_account,
        codex_current_task_preview_by_account=codex_current_task_preview_by_account,
        codex_last_task_preview_by_account=codex_last_task_preview_by_account,
        live_quota_debug_by_account={},
        now=now,
    )

    assert account.id not in codex_current_task_preview_by_account
    assert account.id not in codex_last_task_preview_by_account
