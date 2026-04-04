from __future__ import annotations

import base64
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import text

import app.modules.accounts.auth_manager as auth_manager_module
from app.core.auth import generate_unique_account_id
from app.core.auth.refresh import RefreshError, TokenRefreshResult
from app.db.session import SessionLocal
from app.modules.usage.repository import UsageRepository

pytestmark = pytest.mark.integration



def _encode_jwt(payload: dict) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _write_auth_snapshot(path: Path, *, email: str, account_id: str) -> None:
    payload = {
        "email": email,
        "chatgpt_account_id": account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
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
async def test_import_and_list_accounts(async_client):
    email = "tester@example.com"
    raw_account_id = "acc_explicit"
    payload = {
        "email": email,
        "chatgpt_account_id": "acc_payload",
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }

    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["accountId"] == expected_account_id
    assert data["email"] == email
    assert data["planType"] == "plus"

    list_response = await async_client.get("/api/accounts")
    assert list_response.status_code == 200
    accounts = list_response.json()["accounts"]
    assert any(account["accountId"] == expected_account_id for account in accounts)


@pytest.mark.asyncio
async def test_accounts_list_exposes_latest_active_codex_task_preview(async_client):
    email = "preview@example.com"
    raw_account_id = "acc_preview"
    payload = {
        "email": email,
        "chatgpt_account_id": "acc_preview_payload",
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO sticky_sessions (
                    key, account_id, kind, created_at, updated_at, task_preview, task_updated_at
                )
                VALUES
                    (
                        'preview-active', :account_id, 'codex_session',
                        :active_timestamp, :active_timestamp, :active_preview, :active_timestamp
                    ),
                    (
                        'preview-stale', :account_id, 'codex_session',
                        :stale_timestamp, :stale_timestamp, :stale_preview, :stale_timestamp
                    )
                """
            ),
            {
                "account_id": expected_account_id,
                "active_timestamp": now - timedelta(minutes=2),
                "stale_timestamp": now - timedelta(hours=2),
                "active_preview": "Ship active session preview to dashboard",
                "stale_preview": "This stale preview should not appear",
            },
        )
        await session.commit()

    list_response = await async_client.get("/api/accounts")
    assert list_response.status_code == 200
    accounts = {item["accountId"]: item for item in list_response.json()["accounts"]}
    assert accounts[expected_account_id]["codexCurrentTaskPreview"] == "Ship active session preview to dashboard"
    assert accounts[expected_account_id]["codexLiveSessionCount"] == 0
    assert accounts[expected_account_id]["codexTrackedSessionCount"] == 2
    assert accounts[expected_account_id]["codexSessionCount"] == 0


@pytest.mark.asyncio
async def test_accounts_list_auto_imports_codex_auth_snapshots(
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

    first = await async_client.get("/api/accounts")
    assert first.status_code == 200

    expected_account_id = generate_unique_account_id("acc_tokio", "tokio@example.com")
    accounts = first.json()["accounts"]
    assert len(accounts) == 1
    assert accounts[0]["accountId"] == expected_account_id
    assert accounts[0]["email"] == "tokio@example.com"
    assert accounts[0]["codexAuth"]["hasSnapshot"] is True
    assert accounts[0]["codexAuth"]["snapshotName"] == "tokio"
    assert accounts[0]["codexAuth"]["activeSnapshotName"] == "tokio"
    assert accounts[0]["codexAuth"]["isActiveSnapshot"] is True

    second = await async_client.get("/api/accounts")
    assert second.status_code == 200
    assert len(second.json()["accounts"]) == 1


@pytest.mark.asyncio
async def test_deleted_auto_imported_account_is_not_resurrected(
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
    monkeypatch.setenv("CODEX_AUTH_AUTO_IMPORT_IGNORE_PATH", str(tmp_path / "auto-import-ignore.json"))
    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    listed = await async_client.get("/api/accounts")
    assert listed.status_code == 200
    accounts = listed.json()["accounts"]
    assert len(accounts) == 1
    account_id = accounts[0]["accountId"]

    deleted = await async_client.delete(f"/api/accounts/{account_id}")
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"

    relisted = await async_client.get("/api/accounts")
    assert relisted.status_code == 200
    assert relisted.json()["accounts"] == []


@pytest.mark.asyncio
async def test_accounts_list_sets_has_live_session_from_runtime_telemetry(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    now = datetime.now(timezone.utc)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc_tokio")
    (tmp_path / "current").write_text("tokio")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))

    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    runtime_dir = runtime_root / "terminal-tokio"
    day_dir = runtime_dir / "sessions" / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "current").write_text("tokio")
    _write_rollout_snapshot(
        day_dir / "rollout-1.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=25.0,
        secondary_used=45.0,
    )

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    # First request imports the codex-auth snapshot-backed account.
    initial = await async_client.get("/api/accounts")
    assert initial.status_code == 200

    expected_account_id = generate_unique_account_id("acc_tokio", "tokio@example.com")
    async with SessionLocal() as session:
        for index in range(3):
            await session.execute(
                text(
                    """
                    INSERT INTO sticky_sessions (key, account_id, kind, created_at, updated_at)
                    VALUES (:key, :account_id, :kind, :timestamp, :timestamp)
                    """
                ),
                {
                    "key": f"accounts-sticky-{index + 1}",
                    "account_id": expected_account_id,
                    "kind": "codex_session",
                    "timestamp": now - timedelta(minutes=1),
                },
            )
        await session.commit()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = response.json()["accounts"]
    assert len(accounts) == 1
    account = accounts[0]
    assert account["codexAuth"]["hasLiveSession"] is True
    assert account["codexSessionCount"] == 1
    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(75.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(55.0)

    async with SessionLocal() as session:
        usage_repo = UsageRepository(session)
        latest_primary = await usage_repo.latest_entry_for_account(expected_account_id, window="primary")
        latest_secondary = await usage_repo.latest_entry_for_account(expected_account_id, window="secondary")

    assert latest_primary is not None
    assert latest_secondary is not None
    assert latest_primary.used_percent == pytest.approx(25.0)
    assert latest_secondary.used_percent == pytest.approx(45.0)


@pytest.mark.asyncio
async def test_accounts_list_mixed_sessions_preserves_matched_live_sessions_for_non_active_snapshot_accounts(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    work_raw_id = "acc_work"
    personal_raw_id = "acc_personal"
    work_email = "work@example.com"
    personal_email = "personal@example.com"
    work_account_id = generate_unique_account_id(work_raw_id, work_email)
    personal_account_id = generate_unique_account_id(personal_raw_id, personal_email)

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email=work_email, account_id=work_raw_id)
    _write_auth_snapshot(accounts_dir / "personal.json", email=personal_email, account_id=personal_raw_id)
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    work_ts = now - timedelta(minutes=2)
    personal_ts = now - timedelta(minutes=1)
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

    # First request imports snapshots into accounts.
    first = await async_client.get("/api/accounts")
    assert first.status_code == 200

    work_primary_reset = int((work_ts + timedelta(minutes=30)).timestamp())
    work_secondary_reset = int((work_ts + timedelta(days=7)).timestamp())
    personal_primary_reset = int((personal_ts + timedelta(minutes=30)).timestamp())
    personal_secondary_reset = int((personal_ts + timedelta(days=7)).timestamp())

    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO usage_history (account_id, used_percent, window, reset_at, window_minutes, recorded_at)
                VALUES
                    (:work_account_id, 20.0, 'primary', :work_primary_reset, 300, :work_recorded_at),
                    (:work_account_id, 30.0, 'secondary', :work_secondary_reset, 10080, :work_recorded_at),
                    (:personal_account_id, 40.0, 'primary', :personal_primary_reset, 300, :personal_recorded_at),
                    (:personal_account_id, 50.0, 'secondary', :personal_secondary_reset, 10080, :personal_recorded_at)
                """
            ),
            {
                "work_account_id": work_account_id,
                "work_primary_reset": work_primary_reset,
                "work_secondary_reset": work_secondary_reset,
                "work_recorded_at": work_ts,
                "personal_account_id": personal_account_id,
                "personal_primary_reset": personal_primary_reset,
                "personal_secondary_reset": personal_secondary_reset,
                "personal_recorded_at": personal_ts,
            },
        )
        await session.commit()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = {item["accountId"]: item for item in response.json()["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is True
    assert accounts[work_account_id]["codexSessionCount"] == 1
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(80.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(70.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is True
    assert accounts[personal_account_id]["codexSessionCount"] == 1
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(60.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(50.0)


@pytest.mark.asyncio
async def test_accounts_list_mixed_sessions_keeps_quota_baseline_when_reset_fingerprints_overlap(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    work_raw_id = "acc_work_ambiguous"
    personal_raw_id = "acc_personal_ambiguous"
    work_email = "work.ambiguous@example.com"
    personal_email = "personal.ambiguous@example.com"
    work_account_id = generate_unique_account_id(work_raw_id, work_email)
    personal_account_id = generate_unique_account_id(personal_raw_id, personal_email)

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "work.json", email=work_email, account_id=work_raw_id)
    _write_auth_snapshot(accounts_dir / "personal.json", email=personal_email, account_id=personal_raw_id)
    (tmp_path / "current").write_text("work")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    sample_ts = now - timedelta(minutes=2)
    _write_rollout_snapshot(
        day_dir / "rollout-work.jsonl",
        timestamp=sample_ts,
        primary_used=22.0,
        secondary_used=32.0,
    )
    _write_rollout_snapshot(
        day_dir / "rollout-personal.jsonl",
        timestamp=sample_ts,
        primary_used=23.0,
        secondary_used=33.0,
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    first = await async_client.get("/api/accounts")
    assert first.status_code == 200

    reset_primary = int((sample_ts + timedelta(minutes=30)).timestamp())
    reset_secondary = int((sample_ts + timedelta(days=7)).timestamp())
    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO usage_history (account_id, used_percent, window, reset_at, window_minutes, recorded_at)
                VALUES
                    (:work_account_id, 15.0, 'primary', :reset_primary, 300, :recorded_at),
                    (:work_account_id, 25.0, 'secondary', :reset_secondary, 10080, :recorded_at),
                    (:personal_account_id, 65.0, 'primary', :reset_primary, 300, :recorded_at),
                    (:personal_account_id, 75.0, 'secondary', :reset_secondary, 10080, :recorded_at)
                """
            ),
            {
                "work_account_id": work_account_id,
                "personal_account_id": personal_account_id,
                "reset_primary": reset_primary,
                "reset_secondary": reset_secondary,
                "recorded_at": sample_ts,
            },
        )
        await session.commit()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = {item["accountId"]: item for item in response.json()["accounts"]}

    assert accounts[work_account_id]["codexAuth"]["hasLiveSession"] is True
    assert accounts[work_account_id]["codexAuth"]["liveUsageConfidence"] == "high"
    assert accounts[work_account_id]["codexLiveSessionCount"] == 1
    assert accounts[work_account_id]["codexTrackedSessionCount"] == 0
    assert accounts[work_account_id]["codexSessionCount"] == 1
    assert accounts[work_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(85.0)
    assert accounts[work_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(75.0)

    assert accounts[personal_account_id]["codexAuth"]["hasLiveSession"] is True
    assert accounts[personal_account_id]["codexAuth"]["liveUsageConfidence"] == "low"
    assert accounts[personal_account_id]["codexLiveSessionCount"] == 1
    assert accounts[personal_account_id]["codexTrackedSessionCount"] == 0
    assert accounts[personal_account_id]["codexSessionCount"] == 1
    assert accounts[personal_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(35.0)
    assert accounts[personal_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(25.0)


@pytest.mark.asyncio
async def test_accounts_list_prefers_newer_current_snapshot_over_stale_auth_pointer_for_default_sessions(
    async_client,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    admin_raw_id = "acc_admin"
    bia_raw_id = "acc_bia"
    admin_email = "admin@example.com"
    bia_email = "bia@example.com"
    admin_account_id = generate_unique_account_id(admin_raw_id, admin_email)
    bia_account_id = generate_unique_account_id(bia_raw_id, bia_email)

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "admin.json", email=admin_email, account_id=admin_raw_id)
    _write_auth_snapshot(accounts_dir / "bia.json", email=bia_email, account_id=bia_raw_id)

    auth_path = tmp_path / "auth.json"
    auth_path.symlink_to(accounts_dir / "bia.json")
    current_path = tmp_path / "current"
    current_path.write_text("admin")

    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    sessions_root = tmp_path / "sessions"
    day_dir = sessions_root / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    _write_rollout_snapshot(
        day_dir / "rollout-admin.jsonl",
        timestamp=now - timedelta(minutes=1),
        primary_used=23.0,
        secondary_used=53.0,
    )
    monkeypatch.setenv("CODEX_SESSIONS_DIR", str(sessions_root))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "300")

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = {item["accountId"]: item for item in response.json()["accounts"]}

    assert accounts[admin_account_id]["codexAuth"]["activeSnapshotName"] == "admin"
    assert accounts[admin_account_id]["codexAuth"]["isActiveSnapshot"] is True
    assert accounts[admin_account_id]["codexAuth"]["hasLiveSession"] is True
    assert accounts[admin_account_id]["codexSessionCount"] == 1
    assert accounts[admin_account_id]["usage"]["primaryRemainingPercent"] == pytest.approx(77.0)
    assert accounts[admin_account_id]["usage"]["secondaryRemainingPercent"] == pytest.approx(47.0)

    assert accounts[bia_account_id]["codexAuth"]["isActiveSnapshot"] is False
    assert accounts[bia_account_id]["codexAuth"]["hasLiveSession"] is False


@pytest.mark.asyncio
async def test_accounts_list_detects_live_runtime_session_before_first_token_count(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    now = datetime.now(timezone.utc)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir(parents=True, exist_ok=True)
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc_tokio")
    (tmp_path / "current").write_text("tokio")
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))
    monkeypatch.setenv("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS", "120")

    runtime_root = tmp_path / "runtimes"
    monkeypatch.setenv("CODEX_AUTH_RUNTIME_ROOT", str(runtime_root))
    runtime_dir = runtime_root / "terminal-tokio"
    day_dir = runtime_dir / "sessions" / f"{now.year:04d}" / f"{now.month:02d}" / f"{now.day:02d}"
    day_dir.mkdir(parents=True, exist_ok=True)
    (runtime_dir / "current").write_text("tokio")
    _write_rollout_without_usage(
        day_dir / "rollout-1.jsonl",
        timestamp=now - timedelta(seconds=20),
    )

    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = response.json()["accounts"]
    assert len(accounts) == 1
    account = accounts[0]
    assert account["codexAuth"]["hasLiveSession"] is True
    assert account["codexSessionCount"] == 1


@pytest.mark.asyncio
async def test_accounts_list_uses_sticky_session_count_without_marking_live(async_client):
    email = "sticky@example.com"
    raw_account_id = "acc_sticky"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }

    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    now = datetime.now(timezone.utc)
    async with SessionLocal() as session:
        await session.execute(
            text(
                """
                INSERT INTO sticky_sessions (key, account_id, kind, created_at, updated_at)
                VALUES (:key, :account_id, :kind, :timestamp, :timestamp)
                """
            ),
            {
                "key": "sticky-session-1",
                "account_id": expected_account_id,
                "kind": "codex_session",
                "timestamp": now - timedelta(minutes=1),
            },
        )
        await session.commit()

    list_response = await async_client.get("/api/accounts")
    assert list_response.status_code == 200
    account = next(
        entry for entry in list_response.json()["accounts"] if entry["accountId"] == expected_account_id
    )
    assert account["codexLiveSessionCount"] == 0
    assert account["codexTrackedSessionCount"] == 1
    assert account["codexSessionCount"] == 0
    assert account["codexAuth"]["hasLiveSession"] is False


@pytest.mark.asyncio
async def test_accounts_list_does_not_auto_import_when_disabled(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc_tokio")

    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "false")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    from app.core.config.settings import get_settings

    get_settings.cache_clear()

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    assert response.json()["accounts"] == []


@pytest.mark.asyncio
async def test_reactivate_missing_account_returns_404(async_client):
    response = await async_client.post("/api/accounts/missing/reactivate")
    assert response.status_code == 404
    payload = response.json()
    assert payload["error"]["code"] == "account_not_found"


@pytest.mark.asyncio
async def test_pause_missing_account_returns_404(async_client):
    response = await async_client.post("/api/accounts/missing/pause")
    assert response.status_code == 404
    payload = response.json()
    assert payload["error"]["code"] == "account_not_found"


@pytest.mark.asyncio
async def test_pause_account(async_client):
    email = "pause@example.com"
    raw_account_id = "acc_pause"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }

    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    pause = await async_client.post(f"/api/accounts/{expected_account_id}/pause")
    assert pause.status_code == 200
    assert pause.json()["status"] == "paused"

    accounts = await async_client.get("/api/accounts")
    assert accounts.status_code == 200
    data = accounts.json()["accounts"]
    matched = next((account for account in data if account["accountId"] == expected_account_id), None)
    assert matched is not None
    assert matched["status"] == "paused"


@pytest.mark.asyncio
async def test_delete_missing_account_returns_404(async_client):
    response = await async_client.delete("/api/accounts/missing")
    assert response.status_code == 404
    payload = response.json()
    assert payload["error"]["code"] == "account_not_found"


@pytest.mark.asyncio
async def test_use_account_locally_switches_snapshot(async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    email = "local-switch@example.com"
    raw_account_id = "acc_local_switch"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    current_path = tmp_path / "current"
    auth_path = tmp_path / "auth.json"
    auth_path.symlink_to(Path("/home/app/.codex/accounts/work.json"))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    calls: list[list[str]] = []

    def _run(args, **_kwargs):
        calls.append(args)
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", _run)

    use_response = await async_client.post(f"/api/accounts/{expected_account_id}/use-local")
    assert use_response.status_code == 200
    assert use_response.json()["status"] == "switched"
    assert use_response.json()["snapshotName"] == "work"
    assert calls == [["codex-auth", "use", "work"]]
    assert current_path.read_text(encoding="utf-8").strip() == "work"
    assert auth_path.resolve() == (accounts_dir / "work.json").resolve()


@pytest.mark.asyncio
async def test_use_account_locally_requires_snapshot(async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    email = "local-missing@example.com"
    raw_account_id = "acc_local_missing"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    use_response = await async_client.post(f"/api/accounts/{expected_account_id}/use-local")
    assert use_response.status_code == 400
    assert use_response.json()["error"]["code"] == "codex_auth_snapshot_not_found"


@pytest.mark.asyncio
async def test_use_account_locally_falls_back_when_codex_auth_missing(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    email = "local-not-installed@example.com"
    raw_account_id = "acc_local_not_installed"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    def _raise_missing(*_args, **_kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(subprocess, "run", _raise_missing)

    use_response = await async_client.post(f"/api/accounts/{expected_account_id}/use-local")
    assert use_response.status_code == 200
    assert use_response.json()["status"] == "switched"
    assert use_response.json()["snapshotName"] == "work"
    assert (tmp_path / "current").read_text(encoding="utf-8").strip() == "work"
    assert (tmp_path / "auth.json").resolve() == (accounts_dir / "work.json").resolve()


@pytest.mark.asyncio
async def test_refresh_account_auth_updates_tokens_without_oauth_login(
    async_client, monkeypatch: pytest.MonkeyPatch
):
    email = "reauth-refresh@example.com"
    raw_account_id = "acc_refresh_auth_success"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    async def _fake_refresh(_: str) -> TokenRefreshResult:
        refreshed_payload = {
            "email": email,
            "chatgpt_account_id": raw_account_id,
            "https://api.openai.com/auth": {"chatgpt_plan_type": "team"},
        }
        return TokenRefreshResult(
            access_token="new-access",
            refresh_token="new-refresh",
            id_token=_encode_jwt(refreshed_payload),
            account_id=raw_account_id,
            plan_type="team",
            email=email,
        )

    monkeypatch.setattr(auth_manager_module, "refresh_access_token", _fake_refresh)

    refresh_response = await async_client.post(f"/api/accounts/{expected_account_id}/refresh-auth")
    assert refresh_response.status_code == 200
    assert refresh_response.json() == {
        "status": "refreshed",
        "accountId": expected_account_id,
        "email": email,
        "planType": "team",
    }


@pytest.mark.asyncio
async def test_refresh_account_auth_returns_stable_error_code_on_refresh_failure(
    async_client, monkeypatch: pytest.MonkeyPatch
):
    email = "reauth-failure@example.com"
    raw_account_id = "acc_refresh_auth_failure"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    async def _raise_refresh(_: str) -> TokenRefreshResult:
        raise RefreshError("refresh_token_expired", "Refresh token expired", True)

    monkeypatch.setattr(auth_manager_module, "refresh_access_token", _raise_refresh)

    refresh_response = await async_client.post(f"/api/accounts/{expected_account_id}/refresh-auth")
    assert refresh_response.status_code == 400
    payload = refresh_response.json()
    assert payload["error"]["code"] == "account_refresh_failed"
    assert payload["error"]["message"] == "Refresh token expired"


@pytest.mark.asyncio
async def test_repair_snapshot_readd_aligns_snapshot_name_to_email(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    email = "nagyviktordp@edixai.com"
    raw_account_id = "acc_snapshot_repair_readd"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    repair_response = await async_client.post(
        f"/api/accounts/{expected_account_id}/repair-snapshot?mode=readd"
    )
    assert repair_response.status_code == 200
    payload = repair_response.json()
    assert payload["status"] == "repaired"
    assert payload["mode"] == "readd"
    assert payload["changed"] is True
    assert payload["previousSnapshotName"] == "work"
    assert payload["snapshotName"] == "nagyviktordp-edixai-com"
    assert (accounts_dir / "work.json").exists()
    assert (accounts_dir / "nagyviktordp-edixai-com.json").exists()
    assert (tmp_path / "current").read_text(encoding="utf-8").strip() == "nagyviktordp-edixai-com"


@pytest.mark.asyncio
async def test_repair_snapshot_rename_returns_conflict_when_target_exists(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    email = "nagyviktordp@edixai.com"
    raw_account_id = "acc_snapshot_repair_rename"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    _write_auth_snapshot(
        accounts_dir / "nagyviktordp-edixai-com.json",
        email="other@example.com",
        account_id="acc_other",
    )
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    repair_response = await async_client.post(
        f"/api/accounts/{expected_account_id}/repair-snapshot?mode=rename"
    )
    assert repair_response.status_code == 409
    assert repair_response.json()["error"]["code"] == "codex_auth_snapshot_conflict"


@pytest.mark.asyncio
async def test_open_account_terminal_switches_snapshot_and_launches(
    async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    email = "terminal-launch@example.com"
    raw_account_id = "acc_terminal_launch"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    current_path = tmp_path / "current"
    auth_path = tmp_path / "auth.json"
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    def _run(args, **_kwargs):
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", _run)

    launched: list[str] = []
    from app.modules.accounts import api as accounts_api

    def _open_host_terminal(*, snapshot_name: str):
        launched.append(snapshot_name)

    monkeypatch.setattr(accounts_api, "open_host_terminal", _open_host_terminal)

    open_response = await async_client.post(f"/api/accounts/{expected_account_id}/open-terminal")
    assert open_response.status_code == 200
    assert open_response.json()["status"] == "opened"
    assert open_response.json()["snapshotName"] == "work"
    assert launched == ["work"]
    assert current_path.read_text(encoding="utf-8").strip() == "work"


@pytest.mark.asyncio
async def test_open_account_terminal_returns_launch_error(async_client, monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    email = "terminal-error@example.com"
    raw_account_id = "acc_terminal_error"
    payload = {
        "email": email,
        "chatgpt_account_id": raw_account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access",
            "refreshToken": "refresh",
            "accountId": raw_account_id,
        },
    }
    expected_account_id = generate_unique_account_id(raw_account_id, email)
    files = {"auth_json": ("auth.json", json.dumps(auth_json), "application/json")}
    response = await async_client.post("/api/accounts/import", files=files)
    assert response.status_code == 200

    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=raw_account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    def _run(args, **_kwargs):
        return subprocess.CompletedProcess(args=args, returncode=0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", _run)

    from app.modules.accounts import api as accounts_api
    from app.modules.accounts.terminal import TerminalLaunchError

    def _open_host_terminal(*, snapshot_name: str):
        raise TerminalLaunchError(f"boom for {snapshot_name}")

    monkeypatch.setattr(accounts_api, "open_host_terminal", _open_host_terminal)

    open_response = await async_client.post(f"/api/accounts/{expected_account_id}/open-terminal")
    assert open_response.status_code == 400
    assert open_response.json()["error"]["code"] == "terminal_launch_failed"
