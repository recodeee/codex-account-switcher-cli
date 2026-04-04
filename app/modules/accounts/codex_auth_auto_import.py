from __future__ import annotations

import json
import os
from pathlib import Path
from typing import NamedTuple

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
from app.modules.accounts.codex_auth_switcher import build_email_snapshot_name, select_snapshot_name
from app.modules.accounts.repository import AccountIdentityConflictError, AccountsRepository
from app.modules.proxy.account_cache import get_account_selection_cache


class ParsedSnapshotAuth(NamedTuple):
    account: Account
    access_token: str
    refresh_token: str
    id_token: str


async def sync_local_codex_auth_snapshots(*, repo: AccountsRepository, encryptor: TokenEncryptor) -> None:
    if not get_settings().codex_auth_auto_import_on_accounts_list:
        return

    accounts_dir = _resolve_codex_auth_accounts_dir()
    active_auth_path = _resolve_codex_auth_path()
    _materialize_active_auth_snapshot(
        accounts_dir=accounts_dir,
        active_auth_path=active_auth_path,
        encryptor=encryptor,
    )

    ignored_account_ids = list_auto_import_ignored_account_ids()
    changed_any = False
    for snapshot_path in _collect_codex_auth_snapshot_paths():
        try:
            raw = snapshot_path.read_bytes()
        except OSError:
            continue

        parsed = _parse_account_from_auth_bytes(raw=raw, encryptor=encryptor)
        if parsed is None:
            continue
        account = parsed.account
        if account.id in ignored_account_ids:
            continue

        existing = await repo.get_by_id(account.id)
        if existing is not None:
            snapshot_tokens_changed = not _existing_tokens_match(
                existing=existing,
                access_token=parsed.access_token,
                refresh_token=parsed.refresh_token,
                id_token=parsed.id_token,
                encryptor=encryptor,
            )
            if existing.status == AccountStatus.DEACTIVATED and (
                _should_reactivate_deactivated_account(existing) or snapshot_tokens_changed
            ):
                try:
                    await repo.upsert(account)
                except AccountIdentityConflictError:
                    continue
                changed_any = True
            elif snapshot_tokens_changed:
                try:
                    await repo.upsert(account)
                except AccountIdentityConflictError:
                    continue
                changed_any = True
            continue

        try:
            await repo.upsert(account)
        except AccountIdentityConflictError:
            continue
        changed_any = True

    if changed_any:
        get_account_selection_cache().invalidate()


def _parse_account_from_auth_bytes(*, raw: bytes, encryptor: TokenEncryptor) -> ParsedSnapshotAuth | None:
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
    return ParsedSnapshotAuth(
        account=Account(
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
        ),
        access_token=auth.tokens.access_token,
        refresh_token=auth.tokens.refresh_token,
        id_token=auth.tokens.id_token,
    )


def _existing_tokens_match(
    *,
    existing: Account,
    access_token: str,
    refresh_token: str,
    id_token: str,
    encryptor: TokenEncryptor,
) -> bool:
    try:
        existing_access = encryptor.decrypt(existing.access_token_encrypted)
        existing_refresh = encryptor.decrypt(existing.refresh_token_encrypted)
        existing_id = encryptor.decrypt(existing.id_token_encrypted)
    except Exception:
        return False
    return (
        existing_access == access_token
        and existing_refresh == refresh_token
        and existing_id == id_token
    )


def _collect_codex_auth_snapshot_paths() -> list[Path]:
    accounts_dir = _resolve_codex_auth_accounts_dir()
    snapshots = _collect_snapshot_files(accounts_dir)

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


def _collect_snapshot_files(accounts_dir: Path) -> list[Path]:
    if not accounts_dir.exists() or not accounts_dir.is_dir():
        return []
    return sorted(
        (path for path in accounts_dir.iterdir() if path.is_file() and path.suffix == ".json"),
        key=lambda path: path.name,
    )


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


def _materialize_active_auth_snapshot(
    *,
    accounts_dir: Path,
    active_auth_path: Path,
    encryptor: TokenEncryptor,
) -> None:
    if not active_auth_path.exists() or not active_auth_path.is_file():
        return

    snapshots = _collect_snapshot_files(accounts_dir)
    try:
        active_target = active_auth_path.resolve()
    except OSError:
        active_target = active_auth_path

    snapshot_targets = {snapshot.resolve() for snapshot in snapshots}
    if active_target in snapshot_targets:
        return

    try:
        raw = active_auth_path.read_bytes()
    except OSError:
        return

    parsed = _parse_account_from_auth_bytes(raw=raw, encryptor=encryptor)
    if parsed is None:
        return

    snapshot_name = _select_snapshot_name_for_account(
        account_id=parsed.account.id,
        email=parsed.account.email,
        accounts_dir=accounts_dir,
    )
    if not snapshot_name:
        return

    snapshot_path = accounts_dir / f"{snapshot_name}.json"
    try:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        if snapshot_path.exists() and snapshot_path.read_bytes() == raw:
            return
        snapshot_path.write_bytes(raw)
    except OSError:
        return


def _select_snapshot_name_for_account(
    *,
    account_id: str,
    email: str,
    accounts_dir: Path,
) -> str | None:
    snapshot_names_by_account_id = _snapshot_names_by_account_id(accounts_dir)
    existing_names = snapshot_names_by_account_id.get(account_id, [])
    if existing_names:
        selected = select_snapshot_name(existing_names, None, email=email)
        return selected or existing_names[0]

    base_name = build_email_snapshot_name(email)
    candidate = base_name
    suffix = 2
    while (accounts_dir / f"{candidate}.json").exists():
        candidate = f"{base_name}-{suffix}"
        suffix += 1
    return candidate


def _snapshot_names_by_account_id(accounts_dir: Path) -> dict[str, list[str]]:
    names_by_account_id: dict[str, list[str]] = {}
    for snapshot_path in _collect_snapshot_files(accounts_dir):
        try:
            auth = parse_auth_json(snapshot_path.read_bytes())
        except (json.JSONDecodeError, ValidationError, UnicodeDecodeError, TypeError, OSError):
            continue

        claims = claims_from_auth(auth)
        email = claims.email or DEFAULT_EMAIL
        account_id = generate_unique_account_id(claims.account_id, email)
        names_by_account_id.setdefault(account_id, []).append(snapshot_path.stem)

    for snapshot_names in names_by_account_id.values():
        snapshot_names.sort()
    return names_by_account_id


def _should_reactivate_deactivated_account(account: Account) -> bool:
    """Allow snapshot auto-import recovery except for API-disconnected accounts.

    Usage refresh marks disconnected/invalid workspace memberships as deactivated
    with reasons like ``Usage API error: HTTP 403 - Forbidden``.
    Keep those accounts deactivated until explicit re-auth instead of
    immediately resurrecting them from local snapshot files.
    """

    reason = (account.deactivation_reason or "").strip().lower()
    if reason.startswith("usage api error: http "):
        return False
    return True
