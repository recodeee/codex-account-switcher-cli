from __future__ import annotations

import base64
import json
import os
import subprocess
from pathlib import Path

import pytest

from app.core.auth import generate_unique_account_id
from app.modules.accounts.codex_auth_switcher import (
    CodexAuthSnapshotIndex,
    CodexAuthSnapshotConflictError,
    CodexAuthNotInstalledError,
    build_email_snapshot_name,
    CodexAuthSwitchFailedError,
    build_snapshot_index,
    repair_snapshot_for_account,
    resolve_snapshot_names_for_account,
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


def test_build_snapshot_index_prefers_auth_pointer_over_registry_active_account_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    codex_dir = tmp_path / ".codex"
    accounts_dir = codex_dir / "accounts"
    accounts_dir.mkdir(parents=True)
    _write_auth_snapshot(accounts_dir / "bia.json", email="bia@example.com", account_id="acc-bia")
    _write_auth_snapshot(accounts_dir / "codexina.json", email="codexina@example.com", account_id="acc-codexina")

    (codex_dir / "current").write_text("codexina")
    auth_path = codex_dir / "auth.json"
    auth_path.symlink_to(accounts_dir / "codexina.json")
    (accounts_dir / "registry.json").write_text(json.dumps({"activeAccountName": "bia"}), encoding="utf-8")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(codex_dir / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    index = build_snapshot_index()

    assert index.active_snapshot_name == "codexina"


def test_build_snapshot_index_falls_back_to_auth_pointer_when_registry_active_account_is_invalid(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    codex_dir = tmp_path / ".codex"
    accounts_dir = codex_dir / "accounts"
    accounts_dir.mkdir(parents=True)
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc-tokio")
    _write_auth_snapshot(accounts_dir / "bia.json", email="bia@example.com", account_id="acc-bia")

    (codex_dir / "current").write_text("tokio")
    auth_path = codex_dir / "auth.json"
    auth_path.symlink_to(accounts_dir / "bia.json")
    (accounts_dir / "registry.json").write_text(
        json.dumps({"activeAccountName": "missing-snapshot"}),
        encoding="utf-8",
    )

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(codex_dir / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    index = build_snapshot_index()

    assert index.active_snapshot_name == "bia"


def test_build_snapshot_index_falls_back_to_current_when_auth_pointer_is_invalid(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    codex_dir = tmp_path / ".codex"
    accounts_dir = codex_dir / "accounts"
    accounts_dir.mkdir(parents=True)
    _write_auth_snapshot(accounts_dir / "tokio.json", email="tokio@example.com", account_id="acc-tokio")
    _write_auth_snapshot(accounts_dir / "bia.json", email="bia@example.com", account_id="acc-bia")

    (codex_dir / "current").write_text("tokio")
    auth_path = codex_dir / "auth.json"
    auth_path.symlink_to(Path("/home/app/.codex/accounts/bia.json"))
    (accounts_dir / "registry.json").write_text(json.dumps({"activeAccountName": "bia"}), encoding="utf-8")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(codex_dir / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(auth_path))

    index = build_snapshot_index()

    assert index.active_snapshot_name == "tokio"


def test_select_snapshot_name_prefers_active() -> None:
    selected = select_snapshot_name(["alpha", "beta"], "beta")
    assert selected == "beta"


def test_select_snapshot_name_prefers_email_canonical_name_when_active_missing() -> None:
    selected = select_snapshot_name(
        ["main", "codexina"],
        None,
        email="codexina@edixai.com",
    )
    assert selected == "codexina"


def test_select_snapshot_name_falls_back_to_first_when_no_canonical_match() -> None:
    selected = select_snapshot_name(
        ["main", "runtime"],
        None,
        email="codexina@edixai.com",
    )
    assert selected == "main"


def test_resolve_snapshot_names_for_account_supports_legacy_raw_account_ids(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    (tmp_path / "current").write_text("main")
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    index = build_snapshot_index()

    resolved = resolve_snapshot_names_for_account(
        snapshot_index=index,
        account_id="acc-main",  # legacy persisted id (without email hash)
        chatgpt_account_id="acc-main",
        email="main@example.com",
    )

    assert resolved == ["main"]


def test_resolve_snapshot_names_for_account_handles_email_case_drift(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    (tmp_path / "current").write_text("main")
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    index = build_snapshot_index()

    resolved = resolve_snapshot_names_for_account(
        snapshot_index=index,
        account_id="legacy-main",
        chatgpt_account_id="acc-main",
        email="Main@Example.com",
    )

    assert resolved == ["main"]


def test_resolve_snapshot_names_for_account_prefers_canonical_id_over_stale_persisted_id() -> None:
    canonical_id = generate_unique_account_id("acc-main", "main@example.com")
    index = CodexAuthSnapshotIndex(
        snapshots_by_account_id={
            "stale-account-id": ["wrong-snapshot"],
            canonical_id: ["main-snapshot"],
        },
        active_snapshot_name=None,
    )

    resolved = resolve_snapshot_names_for_account(
        snapshot_index=index,
        account_id="stale-account-id",
        chatgpt_account_id="acc-main",
        email="main@example.com",
    )

    assert resolved == ["main-snapshot"]


def test_switch_snapshot_falls_back_without_codex_auth(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "main.json", email="main@example.com", account_id="acc-main")
    (accounts_dir / "registry.json").write_text(
        json.dumps({"activeAccountName": "bia"}),
        encoding="utf-8",
    )
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
    registry_payload = json.loads((accounts_dir / "registry.json").read_text(encoding="utf-8"))
    assert registry_payload["activeAccountName"] == "main"


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
    (accounts_dir / "registry.json").write_text(
        json.dumps({"activeAccountName": "bia"}),
        encoding="utf-8",
    )
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
    registry_payload = json.loads((accounts_dir / "registry.json").read_text(encoding="utf-8"))
    assert registry_payload["activeAccountName"] == "main"


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


def test_build_email_snapshot_name_normalizes_email() -> None:
    assert build_email_snapshot_name("Viktor+Biz@EdiXAI.com") == "viktor-biz-edixai-com"


def test_repair_snapshot_for_account_readd_copies_snapshot_to_email_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp@gmail.com"
    account_id = "acc-work"
    canonical_account_id = generate_unique_account_id(account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    old_snapshot_path = accounts_dir / "work.json"
    _write_auth_snapshot(old_snapshot_path, email=email, account_id=account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    result = repair_snapshot_for_account(
        account_id=canonical_account_id,
        chatgpt_account_id=account_id,
        email=email,
        mode="readd",
    )

    expected_snapshot_name = "nagy.viktordp-gmail-com"
    expected_snapshot_path = accounts_dir / f"{expected_snapshot_name}.json"
    assert result.mode == "readd"
    assert result.changed is True
    assert result.previous_snapshot_name == "work"
    assert result.snapshot_name == expected_snapshot_name
    assert old_snapshot_path.exists()
    assert expected_snapshot_path.exists()
    assert expected_snapshot_path.read_text(encoding="utf-8") == old_snapshot_path.read_text(encoding="utf-8")
    assert (tmp_path / "current").read_text(encoding="utf-8").strip() == expected_snapshot_name
    assert (tmp_path / "auth.json").resolve() == expected_snapshot_path.resolve()


def test_repair_snapshot_for_account_rename_moves_snapshot_to_email_name(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagyviktordp@edixai.com"
    account_id = "acc-work"
    canonical_account_id = generate_unique_account_id(account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    old_snapshot_path = accounts_dir / "work.json"
    _write_auth_snapshot(old_snapshot_path, email=email, account_id=account_id)
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    result = repair_snapshot_for_account(
        account_id=canonical_account_id,
        chatgpt_account_id=account_id,
        email=email,
        mode="rename",
    )

    expected_snapshot_name = "nagyviktordp-edixai-com"
    expected_snapshot_path = accounts_dir / f"{expected_snapshot_name}.json"
    assert result.mode == "rename"
    assert result.changed is True
    assert result.previous_snapshot_name == "work"
    assert result.snapshot_name == expected_snapshot_name
    assert not old_snapshot_path.exists()
    assert expected_snapshot_path.exists()
    assert (tmp_path / "current").read_text(encoding="utf-8").strip() == expected_snapshot_name
    assert (tmp_path / "auth.json").resolve() == expected_snapshot_path.resolve()


def test_repair_snapshot_for_account_raises_on_target_conflict(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagyviktordp@edixai.com"
    account_id = "acc-work"
    canonical_account_id = generate_unique_account_id(account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id=account_id)
    _write_auth_snapshot(accounts_dir / "nagyviktordp-edixai-com.json", email="other@example.com", account_id="acc-other")
    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_CURRENT_PATH", str(tmp_path / "current"))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "auth.json"))

    with pytest.raises(CodexAuthSnapshotConflictError):
        repair_snapshot_for_account(
            account_id=canonical_account_id,
            chatgpt_account_id=account_id,
            email=email,
            mode="rename",
        )
