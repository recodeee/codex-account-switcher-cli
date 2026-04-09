from __future__ import annotations

import base64
import json
from pathlib import Path

import pytest
from sqlalchemy.exc import OperationalError

from app.core.crypto import TokenEncryptor
from app.core.auth import generate_unique_account_id
from app.modules.accounts.codex_auth_auto_import import (
    _reset_auto_import_sync_window_for_tests,
    _materialize_active_auth_snapshot,
    _select_snapshot_name_for_account,
    sync_local_codex_auth_snapshots,
)
from app.modules.accounts.codex_auth_switcher import build_email_snapshot_name

pytestmark = pytest.mark.unit


def _encode_jwt(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    body = base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")
    return f"header.{body}.sig"


def _write_auth_snapshot(
    path: Path,
    *,
    email: str,
    account_id: str,
    access_token: str = "access",
    refresh_token: str = "refresh",
    id_token: str | None = None,
) -> None:
    payload = {
        "email": email,
        "chatgpt_account_id": account_id,
        "https://api.openai.com/auth": {"chatgpt_plan_type": "plus"},
    }
    encoded_id_token = id_token or _encode_jwt(payload)
    auth_json = {
        "tokens": {
            "idToken": encoded_id_token,
            "accessToken": access_token,
            "refreshToken": refresh_token,
            "accountId": account_id,
        },
    }
    path.write_text(json.dumps(auth_json), encoding="utf-8")


def test_select_snapshot_name_for_account_prefers_canonical_email_snapshot(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp@gmail.com"
    raw_account_id = "acc-main"
    canonical_account_id = generate_unique_account_id(raw_account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    _write_auth_snapshot(accounts_dir / "unique.json", email=email, account_id=raw_account_id)
    _write_auth_snapshot(accounts_dir / "nagy.viktordp@gmail.com.json", email=email, account_id=raw_account_id)

    selected = _select_snapshot_name_for_account(
        account_id=canonical_account_id,
        email=email,
        accounts_dir=accounts_dir,
    )

    assert selected == "nagy.viktordp@gmail.com"


def test_select_snapshot_name_for_account_preserves_existing_generic_snapshot_for_same_account(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp@gmail.com"
    raw_account_id = "acc-main"
    canonical_account_id = generate_unique_account_id(raw_account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    _write_auth_snapshot(accounts_dir / "unique.json", email=email, account_id=raw_account_id)

    selected = _select_snapshot_name_for_account(
        account_id=canonical_account_id,
        email=email,
        accounts_dir=accounts_dir,
    )

    assert selected == "nagy.viktordp@gmail.com"


def test_select_snapshot_name_for_account_appends_dup_suffix_when_email_alias_taken_by_other_account(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp+biz@gmail.com"
    raw_account_id = "acc-main"
    canonical_account_id = generate_unique_account_id(raw_account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    # Another account already owns the canonical email-derived name.
    taken_name = build_email_snapshot_name(email)
    _write_auth_snapshot(
        accounts_dir / f"{taken_name}.json",
        email="nagy.viktordp-biz@gmail.com",
        account_id="acc-other",
    )

    selected = _select_snapshot_name_for_account(
        account_id=canonical_account_id,
        email=email,
        accounts_dir=accounts_dir,
    )

    assert selected == f"{taken_name}--dup-2"


def test_select_snapshot_name_for_account_reuses_existing_dup_alias_for_same_identity(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp+biz@gmail.com"
    raw_account_id = "acc-main"
    canonical_account_id = generate_unique_account_id(raw_account_id, email)
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    taken_name = build_email_snapshot_name(email)
    _write_auth_snapshot(
        accounts_dir / f"{taken_name}.json",
        email="nagy.viktordp-biz@gmail.com",
        account_id="acc-other",
    )
    _write_auth_snapshot(
        accounts_dir / f"{taken_name}--dup-2.json",
        email=email,
        account_id=raw_account_id,
    )
    _write_auth_snapshot(
        accounts_dir / f"{taken_name}--dup-3.json",
        email=email,
        account_id=raw_account_id,
    )

    selected = _select_snapshot_name_for_account(
        account_id=canonical_account_id,
        email=email,
        accounts_dir=accounts_dir,
    )

    assert selected == f"{taken_name}--dup-2"


def test_select_snapshot_name_for_account_preserves_existing_email_matched_snapshot_when_account_id_drifted(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    email = "nagy.viktordp@gmail.com"
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()

    # Legacy/generic snapshot exists for the same email but under a stale account id.
    _write_auth_snapshot(accounts_dir / "work.json", email=email, account_id="legacy-id")

    canonical_account_id = generate_unique_account_id("new-id", email)
    selected = _select_snapshot_name_for_account(
        account_id=canonical_account_id,
        email=email,
        accounts_dir=accounts_dir,
    )

    assert selected == "nagy.viktordp@gmail.com"


def test_materialize_active_auth_snapshot_updates_existing_alias_and_creates_canonical_snapshot(
    tmp_path: Path,
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    active_auth_path = tmp_path / "auth.json"
    email = "nagy.viktordp@gmail.com"
    raw_account_id = "acc-main"

    legacy_snapshot_path = accounts_dir / "unique.json"
    _write_auth_snapshot(
        legacy_snapshot_path,
        email=email,
        account_id=raw_account_id,
        access_token="old-access",
        refresh_token="old-refresh",
    )
    _write_auth_snapshot(
        active_auth_path,
        email=email,
        account_id=raw_account_id,
        access_token="new-access",
        refresh_token="new-refresh",
    )

    _materialize_active_auth_snapshot(
        accounts_dir=accounts_dir,
        active_auth_path=active_auth_path,
        encryptor=TokenEncryptor(),
    )

    canonical_snapshot_path = accounts_dir / "nagy.viktordp@gmail.com.json"
    assert legacy_snapshot_path.exists()
    assert canonical_snapshot_path.exists()
    assert legacy_snapshot_path.read_bytes() == active_auth_path.read_bytes()
    assert canonical_snapshot_path.read_bytes() == active_auth_path.read_bytes()


def test_materialize_active_auth_snapshot_creates_canonical_when_active_auth_points_to_alias(
    tmp_path: Path,
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    active_auth_path = tmp_path / "auth.json"
    email = "cica@nagyviktor.com"
    raw_account_id = "acc-main"

    alias_snapshot_path = accounts_dir / "amodeus@nagyviktor.com.json"
    _write_auth_snapshot(
        alias_snapshot_path,
        email=email,
        account_id=raw_account_id,
        access_token="current-access",
        refresh_token="current-refresh",
    )
    active_auth_path.symlink_to(alias_snapshot_path)

    _materialize_active_auth_snapshot(
        accounts_dir=accounts_dir,
        active_auth_path=active_auth_path,
        encryptor=TokenEncryptor(),
    )

    canonical_snapshot_path = accounts_dir / "cica@nagyviktor.com.json"
    assert alias_snapshot_path.exists()
    assert canonical_snapshot_path.exists()
    assert alias_snapshot_path.read_bytes() == active_auth_path.read_bytes()
    assert canonical_snapshot_path.read_bytes() == active_auth_path.read_bytes()


def test_materialize_active_auth_snapshot_does_not_refresh_foreign_email_shaped_alias(
    tmp_path: Path,
) -> None:
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    active_auth_path = tmp_path / "auth.json"
    email = "grepolis@megkapja.hu"
    raw_account_id = "acc-megkapja"

    canonical_snapshot_path = accounts_dir / "grepolis@megkapja.hu.json"
    foreign_alias_path = accounts_dir / "odin@megkapja.hu.json"

    _write_auth_snapshot(
        canonical_snapshot_path,
        email=email,
        account_id=raw_account_id,
        access_token="old-canonical-access",
        refresh_token="old-canonical-refresh",
    )
    _write_auth_snapshot(
        foreign_alias_path,
        email=email,
        account_id=raw_account_id,
        access_token="old-foreign-access",
        refresh_token="old-foreign-refresh",
    )
    original_foreign_bytes = foreign_alias_path.read_bytes()

    _write_auth_snapshot(
        active_auth_path,
        email=email,
        account_id=raw_account_id,
        access_token="new-active-access",
        refresh_token="new-active-refresh",
    )

    _materialize_active_auth_snapshot(
        accounts_dir=accounts_dir,
        active_auth_path=active_auth_path,
        encryptor=TokenEncryptor(),
    )

    assert canonical_snapshot_path.read_bytes() == active_auth_path.read_bytes()
    assert foreign_alias_path.read_bytes() == original_foreign_bytes


class _LockedUpsertRepo:
    def __init__(self) -> None:
        self.upsert_calls = 0

    async def get_by_id(self, account_id: str):  # noqa: ANN001
        return None

    async def upsert(self, account):  # noqa: ANN001
        self.upsert_calls += 1
        raise OperationalError("BEGIN IMMEDIATE", {}, Exception("database is locked"))


class _CountingUpsertRepo:
    def __init__(self) -> None:
        self.upsert_calls = 0

    async def get_by_id(self, account_id: str):  # noqa: ANN001
        return None

    async def upsert(self, account):  # noqa: ANN001
        self.upsert_calls += 1
        return account


@pytest.mark.asyncio
async def test_sync_local_codex_auth_snapshots_skips_sqlite_lock_errors(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _reset_auto_import_sync_window_for_tests()
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(
        accounts_dir / "pia@edix.hu.json",
        email="pia@edix.hu",
        account_id="acc-pia",
    )

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    from app.core.config.settings import get_settings

    get_settings.cache_clear()
    repo = _LockedUpsertRepo()

    await sync_local_codex_auth_snapshots(repo=repo, encryptor=TokenEncryptor())

    assert repo.upsert_calls == 1


@pytest.mark.asyncio
async def test_sync_local_codex_auth_snapshots_throttles_repeated_calls(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
) -> None:
    _reset_auto_import_sync_window_for_tests()
    accounts_dir = tmp_path / "accounts"
    accounts_dir.mkdir()
    _write_auth_snapshot(
        accounts_dir / "pia@edix.hu.json",
        email="pia@edix.hu",
        account_id="acc-pia",
    )

    monkeypatch.setenv("CODEX_AUTH_ACCOUNTS_DIR", str(accounts_dir))
    monkeypatch.setenv("CODEX_AUTH_JSON_PATH", str(tmp_path / "missing-auth.json"))
    monkeypatch.setenv("CODEX_LB_CODEX_AUTH_AUTO_IMPORT_ON_ACCOUNTS_LIST", "true")
    from app.core.config.settings import get_settings

    get_settings.cache_clear()
    clock = {"now": 100.0}
    monkeypatch.setattr(
        "app.modules.accounts.codex_auth_auto_import.time.monotonic",
        lambda: clock["now"],
    )

    repo = _CountingUpsertRepo()

    await sync_local_codex_auth_snapshots(repo=repo, encryptor=TokenEncryptor())
    assert repo.upsert_calls == 1

    clock["now"] = 105.0
    await sync_local_codex_auth_snapshots(repo=repo, encryptor=TokenEncryptor())
    assert repo.upsert_calls == 1

    clock["now"] = 116.0
    await sync_local_codex_auth_snapshots(repo=repo, encryptor=TokenEncryptor())
    assert repo.upsert_calls == 2
