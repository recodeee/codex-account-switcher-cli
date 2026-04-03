from __future__ import annotations

import json
import os
from pathlib import Path

from pydantic import ValidationError

from app.core.auth import (
    DEFAULT_EMAIL,
    DEFAULT_PLAN,
    claims_from_auth,
    generate_unique_account_id,
    parse_auth_json,
)
from app.core.config.settings import get_settings
from app.core.crypto import TokenEncryptor
from app.core.plan_types import coerce_account_plan_type
from app.core.utils.time import to_utc_naive, utcnow
from app.db.models import Account, AccountStatus
from app.modules.accounts.codex_auth_auto_import_ignore import list_auto_import_ignored_account_ids
from app.modules.accounts.repository import AccountIdentityConflictError, AccountsRepository
from app.modules.proxy.account_cache import get_account_selection_cache


async def sync_local_codex_auth_snapshots(*, repo: AccountsRepository, encryptor: TokenEncryptor) -> None:
    if not get_settings().codex_auth_auto_import_on_accounts_list:
        return

    ignored_account_ids = list_auto_import_ignored_account_ids()
    imported_any = False
    for snapshot_path in _collect_codex_auth_snapshot_paths():
        try:
            raw = snapshot_path.read_bytes()
        except OSError:
            continue

        account = _parse_account_from_auth_bytes(raw=raw, encryptor=encryptor)
        if account is None:
            continue
        if account.id in ignored_account_ids:
            continue

        existing = await repo.get_by_id(account.id)
        if existing is not None:
            continue

        try:
            await repo.upsert(account)
        except AccountIdentityConflictError:
            continue
        imported_any = True

    if imported_any:
        get_account_selection_cache().invalidate()


def _parse_account_from_auth_bytes(*, raw: bytes, encryptor: TokenEncryptor) -> Account | None:
    try:
        auth = parse_auth_json(raw)
    except (json.JSONDecodeError, ValidationError, UnicodeDecodeError, TypeError):
        return None

    claims = claims_from_auth(auth)
    email = claims.email or DEFAULT_EMAIL
    raw_account_id = claims.account_id
    account_id = generate_unique_account_id(raw_account_id, email)
    plan_type = coerce_account_plan_type(claims.plan_type, DEFAULT_PLAN)
    last_refresh = to_utc_naive(auth.last_refresh_at) if auth.last_refresh_at else utcnow()
    return Account(
        id=account_id,
        chatgpt_account_id=raw_account_id,
        email=email,
        plan_type=plan_type,
        access_token_encrypted=encryptor.encrypt(auth.tokens.access_token),
        refresh_token_encrypted=encryptor.encrypt(auth.tokens.refresh_token),
        id_token_encrypted=encryptor.encrypt(auth.tokens.id_token),
        last_refresh=last_refresh,
        status=AccountStatus.ACTIVE,
        deactivation_reason=None,
    )


def _collect_codex_auth_snapshot_paths() -> list[Path]:
    accounts_dir = _resolve_codex_auth_accounts_dir()
    snapshots: list[Path] = []
    if accounts_dir.exists() and accounts_dir.is_dir():
        snapshots = sorted(
            (path for path in accounts_dir.iterdir() if path.is_file() and path.suffix == ".json"),
            key=lambda path: path.name,
        )

    sources = list(snapshots)
    active_auth_path = _resolve_codex_auth_path()
    if active_auth_path.exists() and active_auth_path.is_file():
        try:
            active_target = active_auth_path.resolve()
        except OSError:
            active_target = active_auth_path
        snapshot_targets = {snapshot.resolve() for snapshot in snapshots}
        if active_target not in snapshot_targets:
            sources.append(active_auth_path)
    return sources


def _resolve_codex_auth_accounts_dir() -> Path:
    raw = os.environ.get("CODEX_AUTH_ACCOUNTS_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".codex" / "accounts").resolve()


def _resolve_codex_auth_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if raw:
        path = Path(raw).expanduser()
        return path if path.is_absolute() else Path.cwd() / path
    return Path.home() / ".codex" / "auth.json"
