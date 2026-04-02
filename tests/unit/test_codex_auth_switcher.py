from __future__ import annotations

import base64
import json
import subprocess
from pathlib import Path

import pytest

from app.core.auth import generate_unique_account_id
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthNotInstalledError,
    CodexAuthSwitchFailedError,
    build_snapshot_index,
    select_snapshot_name,
    switch_snapshot,
)

pytestmark = pytest.mark.unit


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


def test_build_snapshot_index_maps_account_ids(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    (tmp_path / "current").write_text("main")
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")
    (accounts_dir / "broken.json").write_text("{invalid")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    index = build_snapshot_index()

    expected_account_id = generate_unique_account_id("acc-main", "main@example.com")
    assert index.active_snapshot_name == "main"
    assert index.snapshots_by_account_id == {expected_account_id: ["main"]}


def test_build_snapshot_index_resolves_active_from_auth_symlink(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    codex_dir = tmp_path / ".codex"
    accounts_dir = codex_dir / "accounts"
    accounts_dir.mkdir(parents=True)
    _write_auth_snapshot(accounts_dir / "secondary.json", email="secondary@example.com", account_id="acc-secondary")

    auth_path = codex_dir / "auth.json"
    auth_path.symlink_to(accounts_dir / "secondary.json")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(codex_dir / "missing-current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    index = build_snapshot_index()

    assert index.active_snapshot_name == "secondary"


def test_select_snapshot_name_prefers_active() -> None:
    selected = select_snapshot_name(["alpha", "beta"], "beta")
    assert selected == "beta"


def test_switch_snapshot_raises_when_codex_auth_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise_missing(*_args, **_kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(subprocess, "run", _raise_missing)

    with pytest.raises(CodexAuthNotInstalledError):
        switch_snapshot("main")


def test_switch_snapshot_raises_with_command_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["codex-auth", "use", "main"],
            returncode=1,
            stdout="",
            stderr="failed",
        ),
    )

    with pytest.raises(CodexAuthSwitchFailedError, match="failed"):
        switch_snapshot("main")
