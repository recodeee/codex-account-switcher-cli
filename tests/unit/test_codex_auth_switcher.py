from __future__ import annotations

import base64
import json
import os
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


def test_switch_snapshot_falls_back_without_codex_auth(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")
    current_path = tmp_path / "current"
    auth_path = tmp_path / "auth.json"

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    def _raise_missing(*_args, **_kwargs):
        raise FileNotFoundError

    monkeypatch.setattr(subprocess, "run", _raise_missing)

    switch_snapshot("main")

    assert current_path.read_text(encoding="utf-8").strip() == "main"
    assert auth_path.exists()
    assert auth_path.is_symlink()
    assert auth_path.resolve() == (accounts_dir / "main.json").resolve()


def test_switch_snapshot_raises_when_codex_auth_missing_and_fallback_fails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

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


def test_switch_snapshot_repairs_broken_pointer_after_cli_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")
    current_path = tmp_path / "current"
    auth_path = tmp_path / "auth.json"
    auth_path.symlink_to(Path("/home/app/.codex/accounts/main.json"))

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["codex-auth", "use", "main"],
            returncode=0,
            stdout="",
            stderr="",
        ),
    )

    switch_snapshot("main")

    assert current_path.read_text(encoding="utf-8").strip() == "main"
    assert auth_path.resolve() == (accounts_dir / "main.json").resolve()
    assert not os.readlink(auth_path).startswith("/")


def test_switch_snapshot_normalizes_absolute_pointer_after_cli_success(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    snapshot_path = accounts_dir / "main.json"
    _write_auth_snapshot(snapshot_path, email="main@example.com", account_id="acc-main")

    current_path = tmp_path / "current"
    auth_path = tmp_path / "auth.json"
    # Simulate codex-auth writing an absolute pointer.
    auth_path.symlink_to(snapshot_path.resolve())

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(current_path))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    monkeypatch.setattr(
        subprocess,
        "run",
        lambda *_args, **_kwargs: subprocess.CompletedProcess(
            args=["codex-auth", "use", "main"],
            returncode=0,
            stdout="",
            stderr="",
        ),
    )

    switch_snapshot("main")

    assert current_path.read_text(encoding="utf-8").strip() == "main"
    assert auth_path.resolve() == snapshot_path.resolve()
    assert not os.readlink(auth_path).startswith("/")
