from __future__ import annotations

import base64
import json
import os
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


def _encode_jwt(payload: dict[str, object]) -> str:
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
                INSERT INTO sticky_sessions (key, account_id, kind, created_at, updated_at)
                VALUES (:key, :account_id, :kind, :timestamp, :timestamp)
                """
            ),
            {
                "key": "dashboard-session-1",
                "account_id": "acc_dash",
                "kind": "codex_session",
                "timestamp": now - timedelta(minutes=1),
            },
        )
        await session.commit()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()

    assert payload["accounts"][0]["accountId"] == "acc_dash"
    assert payload["accounts"][0]["requestUsage"] is not None
    assert payload["accounts"][0]["requestUsage"]["totalTokens"] == 150
    assert payload["accounts"][0]["codexSessionCount"] == 1
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

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/dashboard/overview")
    assert response.status_code == 200
    payload = response.json()
    account = next(item for item in payload["accounts"] if item["accountId"] == expected_account_id)
    assert account["codexAuth"]["isActiveSnapshot"] is True
    assert account["codexSessionCount"] == 2
    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(99.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(86.0)


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
