from __future__ import annotations

import base64
import json
import os
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.core.auth import generate_unique_account_id

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

    response = await async_client.get("/api/accounts")
    assert response.status_code == 200
    accounts = response.json()["accounts"]
    assert len(accounts) == 1
    account = accounts[0]
    assert account["codexAuth"]["hasLiveSession"] is True
    assert account["usage"]["primaryRemainingPercent"] == pytest.approx(75.0)
    assert account["usage"]["secondaryRemainingPercent"] == pytest.approx(55.0)


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
