from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest

from app.tools.codex_auth_switch import SwitchToolError
from app.tools.codex_auth_sync_all import (
    _collect_import_sources,
    _iter_optional_snapshot_files,
    _iter_snapshot_files,
    _resolve_accounts_dir,
    _resolve_active_auth_path,
)

pytestmark = pytest.mark.unit


def _encode_jwt(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _write_auth_json(path: Path, *, email: str, account_id: str, access_token: str = "access") -> None:
    payload = {"email": email}
    auth_json = {
        "tokens": {
            "idToken": _encode_jwt(payload),
            "accessToken": access_token,
            "refreshToken": "refresh",
            "accountId": account_id,
        },
    }
    path.write_text(json.dumps(auth_json), encoding="utf-8")


def test_iter_snapshot_files_returns_sorted_json_files(tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    (accounts_dir / "zeta.json").write_text("{}")
    (accounts_dir / "alpha.json").write_text("{}")
    (accounts_dir / "notes.txt").write_text("ignore")

    snapshots = _iter_snapshot_files(accounts_dir)

    assert [p.name for p in snapshots] == ["alpha.json", "zeta.json"]


def test_iter_snapshot_files_raises_when_directory_missing(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    with pytest.raises(SwitchToolError):
        _iter_snapshot_files(missing)


def test_resolve_accounts_dir_expands_user_path() -> None:
    resolved = _resolve_accounts_dir("~/.codex/accounts")
    assert resolved == (Path.home() / ".codex" / "accounts").resolve()


def test_iter_optional_snapshot_files_returns_empty_when_dir_missing(tmp_path: Path) -> None:
    missing = tmp_path / "missing"
    assert _iter_optional_snapshot_files(missing) == []


def test_resolve_active_auth_path_skips_when_disabled() -> None:
    assert _resolve_active_auth_path("~/.codex/auth.json", skip_active_auth=True) is None


def test_resolve_active_auth_path_uses_default_when_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    home = tmp_path / "home"
    codex_dir = home / ".codex"
    codex_dir.mkdir(parents=True)
    auth_path = codex_dir / "auth.json"
    auth_path.write_text("{}")
    monkeypatch.setattr(Path, "home", classmethod(lambda cls: home))

    resolved = _resolve_active_auth_path(None, skip_active_auth=False)
    assert resolved == auth_path.resolve()


def test_collect_import_sources_adds_active_auth_when_not_in_accounts(tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    snapshot = accounts_dir / "work.json"
    snapshot.write_text("{}")
    active = tmp_path / "auth.json"
    active.write_text("{}")

    sources = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active)
    assert [path.name for path in sources] == ["work.json", "auth.json"]


def test_collect_import_sources_deduplicates_when_active_auth_points_to_snapshot(tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    snapshot = accounts_dir / "work.json"
    snapshot.write_text("{}")
    active_link = tmp_path / "auth.json"
    active_link.symlink_to(snapshot)

    sources = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active_link)
    assert [path.name for path in sources] == ["work.json"]


def test_collect_import_sources_materializes_active_auth_to_new_email_snapshot(tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    active = tmp_path / "auth.json"
    _write_auth_json(active, email="new.user@example.com", account_id="acc-new", access_token="token-new")

    sources = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active)

    assert [path.name for path in sources] == ["new.user@example.com.json"]
    materialized = accounts_dir / "new.user@example.com.json"
    assert materialized.exists()
    assert json.loads(materialized.read_text(encoding="utf-8"))["tokens"]["accessToken"] == "token-new"


def test_collect_import_sources_refreshes_existing_generic_snapshot_for_same_account(tmp_path: Path) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    existing = accounts_dir / "work.json"
    _write_auth_json(existing, email="old.user@example.com", account_id="acc-old", access_token="token-old")
    active = tmp_path / "auth.json"
    _write_auth_json(active, email="old.user@example.com", account_id="acc-old", access_token="token-fresh")

    sources = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active)

    assert [path.name for path in sources] == ["old.user@example.com.json", "work.json"]
    canonical = accounts_dir / "old.user@example.com.json"
    assert canonical.exists()
    assert json.loads(canonical.read_text(encoding="utf-8"))["tokens"]["accessToken"] == "token-fresh"
    assert json.loads(existing.read_text(encoding="utf-8"))["tokens"]["accessToken"] == "token-fresh"


def test_collect_import_sources_refreshes_existing_snapshot_matched_by_email_when_account_id_drifted(
    tmp_path: Path,
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    existing = accounts_dir / "work.json"
    _write_auth_json(existing, email="same.user@example.com", account_id="acc-legacy", access_token="token-old")
    active = tmp_path / "auth.json"
    _write_auth_json(active, email="same.user@example.com", account_id="acc-new", access_token="token-fresh")

    sources = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active)

    assert [path.name for path in sources] == ["same.user@example.com.json", "work.json"]
    canonical = accounts_dir / "same.user@example.com.json"
    assert canonical.exists()
    assert json.loads(canonical.read_text(encoding="utf-8"))["tokens"]["accessToken"] == "token-fresh"
    assert json.loads(existing.read_text(encoding="utf-8"))["tokens"]["accessToken"] == "token-fresh"
