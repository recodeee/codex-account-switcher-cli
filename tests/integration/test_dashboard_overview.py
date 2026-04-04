from __future__ import annotations

import base64
import json
import os
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

from app.core.auth import generate_unique_account_id
from app.core.crypto import TokenEncryptor
from app.core.utils.time import naive_utc_to_epoch, utcnow
from app.db.models import Account, AccountStatus
from app.db.session import SessionLocal
from app.modules.accounts.repository import AccountsRepository
from app.modules.request_logs.repository import RequestLogsRepository
from app.core.usage.models import RateLimitPayload, UsagePayload, UsageWindow
from app.modules.usage.repository import UsageRepository

pytestmark = pytest.mark.integration


def _make_account(account_id: str, email: str, plan_type: str = "plus") -> Account:
    encryptor = TokenEncryptor()
    return Account(
        id=account_id,
        email=email,
        plan_type=plan_type,
        access_token_encrypted=encryptor.encrypt("access"),
        refresh_token_encrypted=encryptor.encrypt("refresh"),
        id_token_encrypted=encryptor.encrypt("id"),
        last_refresh=utcnow(),
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )


def _encode_jwt(payload: Mapping[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _write_auth_snapshot(path: Path, *, email: str, account_id: str) -> None:
    payload = {"email": email}
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": account_id,
        },
    }
    path.write_text(json.dumps(auth_json))


def _write_rollout_snapshot(
    path: Path,
    *,
    timestamp: datetime,
    primary_used: float,
    secondary_used: float,
) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "rate_limits": {
                "primary": {
                    "used_percent": primary_used,
                    "window_minutes": 300,
                    "resets_at": int((timestamp + timedelta(minutes=30)).timestamp()),
                },
                "secondary": {
                    "used_percent": secondary_used,
                    "window_minutes": 10080,
                    "resets_at": int((timestamp + timedelta(days=7)).timestamp()),
                },
            },
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def _write_rollout_snapshot_without_reset(
    path: Path,
    *,
    timestamp: datetime,
    primary_used: float,
    secondary_used: float,
) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "token_count",
            "rate_limits": {
                "primary": {
                    "used_percent": primary_used,
                    "window_minutes": 300,
                },
                "secondary": {
                    "used_percent": secondary_used,
                    "window_minutes": 10080,
                },
            },
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


def _write_rollout_without_usage(path: Path, *, timestamp: datetime) -> None:
    payload = {
        "timestamp": timestamp.isoformat().replace("+00:00", "Z"),
        "type": "event_msg",
        "payload": {
            "type": "task_started",
        },
    }
    path.write_text(json.dumps(payload) + "\n", encoding="utf-8")
    ts = timestamp.timestamp()
    os.utime(path, (ts, ts))


@pytest.mark.asyncio
async def test_dashboard_overview_combines_data(async_client, db_setup):
    now = utcnow().replace(microsecond=0)
    primary_time = now - timedelta(minutes=5)
    secondary_time = now - timedelta(minutes=2)

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        logs_repo = RequestLogsRepository(session)

        await accounts_repo.upsert(_make_account("acc_dash", "dash@example.com"))
        await usage_repo.add_entry(
            "acc_dash",
            20.0,
            window="primary",
            recorded_at=primary_time,
        )
        await usage_repo.add_entry(
            "acc_dash",
            40.0,
            window="secondary",
            recorded_at=secondary_time,
        )
        await logs_repo.add_log(
            account_id="acc_dash",
            request_id="req_dash_1",
            model="gpt-5.1",
            input_tokens=100,
            output_tokens=50,
            latency_ms=50,
            status="success",
            error_code=None,
            requested_at=now - timedelta(minutes=1),
        )
        await session.execute(
            text(
                """
                INSERT INTO sticky_sessions (
                    key, account_id, kind, created_at, updated_at, task_preview, task_updated_at
                )
                VALUES
                    (
                        :active_key, :account_id, :kind, :active_timestamp, :active_timestamp,
                        :active_task_preview, :active_timestamp
                    ),
                    (
                        :stale_key, :account_id, :kind, :stale_timestamp, :stale_timestamp,
                        :stale_task_preview, :stale_timestamp
                    )
                """
            ),
            {
                "active_key": "dashboard-session-active",
                "stale_key": "dashboard-session-stale",
                "account_id": "acc_dash",
                "kind": "codex_session",
                "active_timestamp": now - timedelta(minutes=1),
                "stale_timestamp": now - timedelta(hours=2),
                "active_task_preview": "Investigate dashboard quota drift",
                "stale_task_preview": "This stale preview should not appear",
            },
        )
        await session.commit()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()

    assert payload["accounts"][0]["accountId"] == "acc_dash"
    assert payload["accounts"][0]["requestUsage"] is not None
    assert payload["accounts"][0]["requestUsage"]["totalTokens"] == 150
    assert payload["accounts"][0]["codexLiveSessionCount"] == 0
    assert payload["accounts"][0]["codexTrackedSessionCount"] == 1
    assert payload["accounts"][0]["codexSessionCount"] == 0
    assert payload["accounts"][0]["codexCurrentTaskPreview"] == "Investigate dashboard quota drift"
    assert payload["accounts"][0]["codexAuth"]["hasLiveSession"] is False
    assert payload["accounts"][0]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert payload["accounts"][0]["usage"]["secondaryRemainingPercent"] == pytest.approx(60.0)
    assert payload["summary"]["primaryWindow"]["capacityCredits"] == pytest.approx(225.0)
    assert payload["windows"]["primary"]["windowKey"] == "primary"
    assert payload["windows"]["secondary"]["windowKey"] == "secondary"
    assert "requestLogs" not in payload
    assert payload["lastSyncAt"] == secondary_time.isoformat() + "Z"

    # Verify trends are present and have 28 data points each
    assert "trends" in payload
    trends = payload["trends"]
    assert len(trends["requests"]) == 28
    assert len(trends["tokens"]) == 28
    assert len(trends["cost"]) == 28
    assert len(trends["errorRate"]) == 28

    # At least one trend point should have non-zero request count
    request_values = [p["v"] for p in trends["requests"]]
    assert any(v > 0 for v in request_values)


@pytest.mark.asyncio
async def test_dashboard_overview_refreshes_stale_usage_for_active_accounts(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
):
    now = utcnow().replace(microsecond=0)
    stale_recorded_at = now - timedelta(hours=17)
    account_id = "acc_refresh_live"

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(account_id, "refresh@example.com"))
        await usage_repo.add_entry(
            account_id,
            100.0,
            window="primary",
            window_minutes=300,
            recorded_at=stale_recorded_at,
        )
        await usage_repo.add_entry(
            account_id,
            100.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=stale_recorded_at,
        )

    async def _fake_fetch_usage(*, access_token: str, account_id: str | None = None):  # noqa: ARG001
        return UsagePayload(
            plan_type="plus",
            rate_limit=RateLimitPayload(
                primary_window=UsageWindow(used_percent=11.0, limit_window_seconds=300 * 60),
                secondary_window=UsageWindow(used_percent=22.0, limit_window_seconds=10080 * 60),
            ),
        )

    monkeypatch.setenv("CODEX_LB_USAGE_REFRESH_ENABLED", "true")
    monkeypatch.setattr("app.modules.usage.updater.fetch_usage", _fake_fetch_usage)
    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    account = next(item for item in payload["accounts"] if item["accountId"] == account_id)

    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(89.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(78.0)
    assert account["lastUsageRecordedAtPrimary"] is not None
    refreshed_primary = datetime.fromisoformat(account["lastUsageRecordedAtPrimary"].replace("Z", "+00:00"))
    assert refreshed_primary.replace(tzinfo=None) >= now - timedelta(seconds=30)


@pytest.mark.asyncio
async def test_dashboard_overview_auto_imports_codex_auth_snapshots(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc_tokio")
    (tmp_path / "current").write_text("tokio")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))
    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    expected_account_id = generate_unique_account_id("acc_tokio", "tokio@example.com")

    account_ids = [account["accountId"] for account in payload["accounts"]]
    assert expected_account_id in account_ids
    matching_account = next(account for account in payload["accounts"] if account["accountId"] == expected_account_id)
    assert matching_account["codexAuth"]["hasSnapshot"] is True
    assert matching_account["codexAuth"]["snapshotName"] == "tokio"
    assert matching_account["codexAuth"]["activeSnapshotName"] == "tokio"
    assert matching_account["codexAuth"]["isActiveSnapshot"] is True


@pytest.mark.asyncio
async def test_dashboard_overview_prefers_local_active_snapshot_usage_and_session_count(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    expected_account_id = generate_unique_account_id("acc_local", "local@example.com")

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(expected_account_id, "local@example.com"))
        await usage_repo.add_entry(
            expected_account_id,
            100.0,
            window="primary",
            window_minutes=300,
            recorded_at=now - timedelta(minutes=2),
        )
        await usage_repo.add_entry(
            expected_account_id,
            88.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=2),
        )
        for index in range(3):
            await session.execute(
                text(
                    """
                    INSERT INTO sticky_sessions (key, account_id, kind, created_at, updated_at)
                    VALUES (:key, :account_id, :kind, :timestamp, :timestamp)
                    """
                ),
                {
                    "key": f"dashboard-sticky-{index + 1}",
                    "account_id": expected_account_id,
                    "kind": "codex_session",
                    "timestamp": now - timedelta(minutes=1),
                },
            )
        await session.commit()

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "local.json", email="local@example.com", account_id="acc_local")
    (tmp_path / "current").write_text("local")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    _write_rollout_snapshot(
        day_dir / "rollout-1.jsonl",
        timestamp=(now - timedelta(minutes=5)).replace(tzinfo=timezone.utc),
        primary_used=22.0,
        secondary_used=35.0,
    )
    _write_rollout_snapshot(
        day_dir / "rollout-2.jsonl",
        timestamp=(now - timedelta(minutes=1)).replace(tzinfo=timezone.utc),
        primary_used=1.0,
        secondary_used=14.0,
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "600")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    account = next(item for item in payload["accounts"] if item["accountId"] == expected_account_id)
    assert account["codexAuth"]["isActiveSnapshot"] is True
    assert account["codexAuth"]["hasLiveSession"] is False
    assert account["codexSessionCount"] == 0
    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(99.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(86.0)

    async with SessionLocal() as session:
        usage_repo = UsageRepository(session)
        latest_primary = await usage_repo.latest_entry_for_account(expected_account_id, window="primary")
        latest_secondary = await usage_repo.latest_entry_for_account(expected_account_id, window="secondary")

    assert latest_primary is not None
    assert latest_secondary is not None
    assert latest_primary.used_percent == pytest.approx(1.0)
    assert latest_secondary.used_percent == pytest.approx(14.0)


@pytest.mark.asyncio
async def test_dashboard_overview_uses_recent_known_usage_before_first_token_count(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    expected_account_id = generate_unique_account_id("acc_local", "local@example.com")

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(expected_account_id, "local@example.com"))
        await usage_repo.add_entry(
            expected_account_id,
            100.0,
            window="primary",
            window_minutes=300,
            recorded_at=now - timedelta(minutes=2),
        )
        await usage_repo.add_entry(
            expected_account_id,
            100.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=2),
        )

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "local.json", email="local@example.com", account_id="acc_local")
    (tmp_path / "current").write_text("local")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "120")

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    _write_rollout_snapshot(
        day_dir / "rollout-recent-known.jsonl",
        timestamp=(now - timedelta(minutes=8)).replace(tzinfo=timezone.utc),
        primary_used=45.0,
        secondary_used=67.0,
    )
    _write_rollout_without_usage(
        day_dir / "rollout-new-active.jsonl",
        timestamp=(now - timedelta(seconds=20)).replace(tzinfo=timezone.utc),
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    account = next(item for item in payload["accounts"] if item["accountId"] == expected_account_id)
    assert account["codexAuth"]["isActiveSnapshot"] is True
    assert account["codexAuth"]["hasLiveSession"] is False
    assert account["codexSessionCount"] == 0
    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(55.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(33.0)


@pytest.mark.asyncio
async def test_dashboard_overview_applies_runtime_live_usage_per_snapshot(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    work_account_id = generate_unique_account_id("acc_work", "work@example.com")
    personal_account_id = generate_unique_account_id("acc_personal", "personal@example.com")

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(work_account_id, "work@example.com"))
        await accounts_repo.upsert(_make_account(personal_account_id, "personal@example.com"))
        await usage_repo.add_entry(
            work_account_id,
            88.0,
            window="primary",
            window_minutes=300,
            recorded_at=now - timedelta(minutes=10),
        )
        await usage_repo.add_entry(
            work_account_id,
            80.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=10),
        )
        await usage_repo.add_entry(
            personal_account_id,
            77.0,
            window="primary",
            window_minutes=300,
            recorded_at=now - timedelta(minutes=10),
        )
        await usage_repo.add_entry(
            personal_account_id,
            66.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=10),
        )

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email="work@example.com", account_id="acc_work")
    _write_auth_snapshot(accounts_dir / "personal.json", email="personal@example.com", account_id="acc_personal")
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))

    work_runtime = runtime_root / "terminal-work"
    work_day_dir = work_runtime / "sessions" / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    work_day_dir.mkdir(parents=True, exist_ok=True)
    (work_runtime / "current").write_text("work")
    _write_rollout_snapshot(
        work_day_dir / "rollout-work.jsonl",
        timestamp=(now - timedelta(minutes=2)).replace(tzinfo=timezone.utc),
        primary_used=20.0,
        secondary_used=30.0,
    )

    personal_runtime = runtime_root / "terminal-personal"
    personal_day_dir = (
        personal_runtime / "sessions" / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    )
    personal_day_dir.mkdir(parents=True, exist_ok=True)
    (personal_runtime / "current").write_text("personal")
    _write_rollout_snapshot(
        personal_day_dir / "rollout-personal.jsonl",
        timestamp=(now - timedelta(minutes=1)).replace(tzinfo=timezone.utc),
        primary_used=40.0,
        secondary_used=50.0,
    )

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    accounts = {item["accountId"]: item for item in payload["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[work_account_id]["codexSessionCount"] == 0
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(70.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[personal_account_id]["codexSessionCount"] == 0
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(60.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_dashboard_overview_matches_default_mixed_sessions_by_fingerprint(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    work_account_id = generate_unique_account_id("acc_work", "work@example.com")
    personal_account_id = generate_unique_account_id("acc_personal", "personal@example.com")

    work_ts = (now - timedelta(minutes=2)).replace(tzinfo=timezone.utc)
    personal_ts = (now - timedelta(minutes=1)).replace(tzinfo=timezone.utc)
    work_primary_reset = int((work_ts + timedelta(minutes=30)).timestamp())
    work_secondary_reset = int((work_ts + timedelta(days=7)).timestamp())
    personal_primary_reset = int((personal_ts + timedelta(minutes=30)).timestamp())
    personal_secondary_reset = int((personal_ts + timedelta(days=7)).timestamp())

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(work_account_id, "work@example.com"))
        await accounts_repo.upsert(_make_account(personal_account_id, "personal@example.com"))
        await usage_repo.add_entry(
            work_account_id,
            20.0,
            window="primary",
            window_minutes=300,
            reset_at=work_primary_reset,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            work_account_id,
            30.0,
            window="secondary",
            window_minutes=10080,
            reset_at=work_secondary_reset,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            personal_account_id,
            40.0,
            window="primary",
            window_minutes=300,
            reset_at=personal_primary_reset,
            recorded_at=personal_ts,
        )
        await usage_repo.add_entry(
            personal_account_id,
            50.0,
            window="secondary",
            window_minutes=10080,
            reset_at=personal_secondary_reset,
            recorded_at=personal_ts,
        )

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email="work@example.com", account_id="acc_work")
    _write_auth_snapshot(accounts_dir / "personal.json", email="personal@example.com", account_id="acc_personal")
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    _write_rollout_snapshot(
        day_dir / "rollout-work.jsonl",
        timestamp=work_ts,
        primary_used=20.0,
        secondary_used=30.0,
    )
    _write_rollout_snapshot(
        day_dir / "rollout-personal.jsonl",
        timestamp=personal_ts,
        primary_used=40.0,
        secondary_used=50.0,
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    accounts = {item["accountId"]: item for item in payload["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[work_account_id]["codexSessionCount"] == 0
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(70.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[personal_account_id]["codexSessionCount"] == 0
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(60.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_dashboard_overview_matches_default_mixed_sessions_without_reset_timestamps(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    work_account_id = generate_unique_account_id("acc_work", "work@example.com")
    personal_account_id = generate_unique_account_id("acc_personal", "personal@example.com")

    work_ts = (now - timedelta(minutes=2)).replace(tzinfo=timezone.utc)
    personal_ts = (now - timedelta(minutes=1)).replace(tzinfo=timezone.utc)

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(work_account_id, "work@example.com"))
        await accounts_repo.upsert(_make_account(personal_account_id, "personal@example.com"))
        await usage_repo.add_entry(
            work_account_id,
            20.0,
            window="primary",
            window_minutes=300,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            work_account_id,
            30.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            personal_account_id,
            40.0,
            window="primary",
            window_minutes=300,
            recorded_at=personal_ts,
        )
        await usage_repo.add_entry(
            personal_account_id,
            50.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=personal_ts,
        )

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email="work@example.com", account_id="acc_work")
    _write_auth_snapshot(accounts_dir / "personal.json", email="personal@example.com", account_id="acc_personal")
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    _write_rollout_snapshot_without_reset(
        day_dir / "rollout-work.jsonl",
        timestamp=work_ts,
        primary_used=20.0,
        secondary_used=30.0,
    )
    _write_rollout_snapshot_without_reset(
        day_dir / "rollout-personal.jsonl",
        timestamp=personal_ts,
        primary_used=40.0,
        secondary_used=50.0,
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    accounts = {item["accountId"]: item for item in payload["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[work_account_id]["codexAuth"]["liveUsageConfidence"] == "high"
    assert accounts[work_account_id]["codexSessionCount"] == 0
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(70.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[personal_account_id]["codexAuth"]["liveUsageConfidence"] == "high"
    assert accounts[personal_account_id]["codexSessionCount"] == 0
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(60.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_dashboard_overview_ignores_stale_token_count_fingerprints_in_mixed_default_sessions(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = utcnow().replace(microsecond=0)
    work_account_id = generate_unique_account_id("acc_work", "work@example.com")
    personal_account_id = generate_unique_account_id("acc_personal", "personal@example.com")

    work_ts = (now - timedelta(minutes=1)).replace(tzinfo=timezone.utc)
    stale_ts = (now - timedelta(hours=2)).replace(tzinfo=timezone.utc)

    work_primary_reset = int((work_ts + timedelta(minutes=30)).timestamp())
    work_secondary_reset = int((work_ts + timedelta(days=7)).timestamp())
    personal_primary_reset = int((now + timedelta(minutes=20)).timestamp())
    personal_secondary_reset = int((now + timedelta(days=6)).timestamp())

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)
        await accounts_repo.upsert(_make_account(work_account_id, "work@example.com"))
        await accounts_repo.upsert(_make_account(personal_account_id, "personal@example.com"))
        await usage_repo.add_entry(
            work_account_id,
            20.0,
            window="primary",
            window_minutes=300,
            reset_at=work_primary_reset,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            work_account_id,
            30.0,
            window="secondary",
            window_minutes=10080,
            reset_at=work_secondary_reset,
            recorded_at=work_ts,
        )
        await usage_repo.add_entry(
            personal_account_id,
            40.0,
            window="primary",
            window_minutes=300,
            reset_at=personal_primary_reset,
            recorded_at=now - timedelta(minutes=2),
        )
        await usage_repo.add_entry(
            personal_account_id,
            50.0,
            window="secondary",
            window_minutes=10080,
            reset_at=personal_secondary_reset,
            recorded_at=now - timedelta(minutes=2),
        )

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email="work@example.com", account_id="acc_work")
    _write_auth_snapshot(accounts_dir / "personal.json", email="personal@example.com", account_id="acc_personal")
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(tmp_path / "runtimes"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)

    fresh = day_dir / "rollout-fresh.jsonl"
    stale = day_dir / "rollout-stale.jsonl"
    _write_rollout_snapshot(
        fresh,
        timestamp=work_ts,
        primary_used=20.0,
        secondary_used=30.0,
    )
    _write_rollout_snapshot(
        stale,
        timestamp=stale_ts,
        primary_used=97.0,
        secondary_used=75.0,
    )
    # Non-token writes can keep file mtime fresh even when token_count payload
    # is stale; mixed-session attribution should ignore that stale fingerprint.
    fresh_mtime = (now - timedelta(seconds=15)).timestamp()
    os.utime(stale, (fresh_mtime, fresh_mtime))

    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    accounts = {item["accountId"]: item for item in payload["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[work_account_id]["codexSessionCount"] == 0
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(70.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is False
    assert accounts[personal_account_id]["codexSessionCount"] == 0
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(60.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_dashboard_overview_maps_weekly_only_primary_to_secondary(async_client, db_setup):
    now = utcnow().replace(microsecond=0)

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)

        await accounts_repo.upsert(_make_account("acc_plus", "plus@example.com", plan_type="plus"))
        await accounts_repo.upsert(_make_account("acc_free", "free@example.com", plan_type="free"))

        await usage_repo.add_entry(
            "acc_plus",
            20.0,
            window="primary",
            window_minutes=300,
            recorded_at=now - timedelta(minutes=2),
        )
        await usage_repo.add_entry(
            "acc_free",
            20.0,
            window="primary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=1),
        )
        await usage_repo.add_entry(
            "acc_plus",
            40.0,
            window="secondary",
            window_minutes=10080,
            recorded_at=now - timedelta(minutes=1),
        )

    response = await async_client.get("/api/dashboard/overview?requestLimit=10&requestOffset=0")
    assert response.status_code == 200
    payload = response.json()

    accounts = {item["accountId"]: item for item in payload["accounts"]}

    assert payload["summary"]["primaryWindow"]["windowMinutes"] == 300
    assert payload["windows"]["primary"]["windowMinutes"] == 300
    assert payload["summary"]["secondaryWindow"]["windowMinutes"] == 10080
    assert accounts["acc_free"]["windowMinutesPrimary"] is None
    assert accounts["acc_free"]["windowMinutesSecondary"] == 10080
    assert accounts["acc_free"]["usage"]["secondaryRemainingPercent"] == pytest.approx(80.0)


@pytest.mark.asyncio
async def test_dashboard_overview_computes_depletion_from_recent_db_history(async_client, db_setup):
    now = utcnow().replace(microsecond=0)

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)

        await accounts_repo.upsert(_make_account("acc_depletion", "depletion@example.com"))
        await usage_repo.add_entry(
            "acc_depletion",
            10.0,
            window="primary",
            window_minutes=60,
            reset_at=int(naive_utc_to_epoch(now + timedelta(minutes=45))),
            recorded_at=now - timedelta(minutes=20),
        )
        await usage_repo.add_entry(
            "acc_depletion",
            35.0,
            window="primary",
            window_minutes=60,
            reset_at=int(naive_utc_to_epoch(now + timedelta(minutes=45))),
            recorded_at=now - timedelta(minutes=5),
        )

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200

    payload = response.json()
    assert payload["depletionPrimary"] is not None
    assert 0.0 <= payload["depletionPrimary"]["risk"] <= 1.0
    assert payload["depletionPrimary"]["riskLevel"] in {"safe", "warning", "danger", "critical"}


@pytest.mark.asyncio
async def test_dashboard_overview_weekly_only_depletion_uses_current_stream(async_client, db_setup):
    now = utcnow().replace(microsecond=0)
    reset_at = int(naive_utc_to_epoch(now + timedelta(minutes=30)))

    async with SessionLocal() as session:
        accounts_repo = AccountsRepository(session)
        usage_repo = UsageRepository(session)

        await accounts_repo.upsert(_make_account("acc_weekly_depletion", "weekly@example.com", plan_type="free"))

        await usage_repo.add_entry(
            "acc_weekly_depletion",
            0.0,
            window="secondary",
            window_minutes=10080,
            reset_at=reset_at,
            recorded_at=now - timedelta(days=6, minutes=2),
        )
        await usage_repo.add_entry(
            "acc_weekly_depletion",
            5.0,
            window="secondary",
            window_minutes=10080,
            reset_at=reset_at,
            recorded_at=now - timedelta(days=6, minutes=1),
        )
        await usage_repo.add_entry(
            "acc_weekly_depletion",
            6.0,
            window="primary",
            window_minutes=10080,
            reset_at=reset_at,
            recorded_at=now - timedelta(minutes=2),
        )
        await usage_repo.add_entry(
            "acc_weekly_depletion",
            7.0,
            window="primary",
            window_minutes=10080,
            reset_at=reset_at,
            recorded_at=now - timedelta(minutes=1),
        )

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200

    payload = response.json()
    assert payload["depletionSecondary"] is not None
    assert payload["depletionSecondary"]["risk"] == pytest.approx(0.37, abs=0.02)
