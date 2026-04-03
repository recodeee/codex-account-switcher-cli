from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.auth import generate_unique_account_id

pytestmark = pytest.mark.integration


def _encode_jwt(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _make_auth_json(account_id: str, email: str, plan_type: str = "plus") -> dict[str, object]:
    payload = {
        "email": email,
        "https://api.openai.com/auth": {"chatgpt_plan_type": plan_type},
        "chatgpt_account_id": account_id,
    }
    return {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": "access-token",
            "refreshToken": "refresh-token",
            "accountId": account_id,
        }
    }


def _configure_codex_auth_paths(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    accounts_dir = tmp_path / "accounts"
    current_path = tmp_path / "current"
    active_auth_path = tmp_path / "auth.json"
    accounts_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(active_auth_path))
    monkeypatch.setenv("CODEX_LB_TERMINAL_CWD", str(tmp_path))
    return accounts_dir


def test_account_terminal_websocket_streams_process_output(app_instance, monkeypatch, tmp_path):
    accounts_dir = _configure_codex_auth_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("CODEX_LB_TERMINAL_COMMAND", "printf 'codex-ready\\n'")

    raw_account_id = "acct_terminal_ok"
    email = "terminal-ok@example.com"
    auth_json = _make_auth_json(raw_account_id, email)
    account_id = generate_unique_account_id(raw_account_id, email)

    snapshot_path = accounts_dir / "work.json"
    snapshot_path.write_text(json.dumps(auth_json), encoding="utf-8")

    with TestClient(app_instance) as client:
        import_response = client.post(
            "/api/accounts/import",
            files={"auth_json": ("auth.json", json.dumps(auth_json), "application/json")},
        )
        assert import_response.status_code == 200
        assert import_response.json()["accountId"] == account_id

        with client.websocket_connect(f"/api/accounts/{account_id}/terminal/ws") as websocket:
            messages: list[dict[str, object]] = []
            sent_echo = False
            sent_exit = False
            for _ in range(120):
                message = json.loads(websocket.receive_text())
                messages.append(message)

                if message.get("type") == "output":
                    output_chunk = str(message.get("data", ""))
                    if "codex-ready" in output_chunk and not sent_echo:
                        websocket.send_text(json.dumps({"type": "input", "data": "echo still-open\n"}))
                        sent_echo = True
                        continue

                    if "still-open" in output_chunk and sent_echo and not sent_exit:
                        websocket.send_text(json.dumps({"type": "input", "data": "exit\n"}))
                        sent_exit = True
                        continue

                if message.get("type") == "exit":
                    break

    ready = next((message for message in messages if message.get("type") == "ready"), None)
    output = "".join(
        str(message.get("data", ""))
        for message in messages
        if message.get("type") == "output"
    )
    exit_message = next((message for message in messages if message.get("type") == "exit"), None)

    assert ready is not None
    assert ready["snapshotName"] == "work"
    assert "codex-ready" in output
    assert "still-open" in output
    assert exit_message is not None
    assert exit_message["code"] == 0


def test_account_terminal_websocket_reports_missing_snapshot(app_instance, monkeypatch, tmp_path):
    _configure_codex_auth_paths(monkeypatch, tmp_path)
    monkeypatch.setenv("CODEX_LB_TERMINAL_COMMAND", "printf 'should-not-run\\n'")

    raw_account_id = "acct_terminal_missing"
    email = "terminal-missing@example.com"
    auth_json = _make_auth_json(raw_account_id, email)
    account_id = generate_unique_account_id(raw_account_id, email)

    with TestClient(app_instance) as client:
        import_response = client.post(
            "/api/accounts/import",
            files={"auth_json": ("auth.json", json.dumps(auth_json), "application/json")},
        )
        assert import_response.status_code == 200
        assert import_response.json()["accountId"] == account_id

        with client.websocket_connect(f"/api/accounts/{account_id}/terminal/ws") as websocket:
            first = json.loads(websocket.receive_text())

    assert first["type"] == "error"
    assert first["code"] == "codex_auth_snapshot_not_found"
