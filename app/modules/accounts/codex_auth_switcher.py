from __future__ import annotations

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from app.core.auth import DEFAULT_EMAIL, claims_from_auth, generate_unique_account_id, parse_auth_json


class CodexAuthSnapshotNotFoundError(RuntimeError):
    """Raised when no codex-auth snapshot can be resolved for an account."""


class CodexAuthNotInstalledError(RuntimeError):
    """Raised when codex-auth CLI is unavailable on the host."""


class CodexAuthSwitchFailedError(RuntimeError):
    """Raised when codex-auth use fails for a resolved snapshot."""


@dataclass(slots=True, frozen=True)
class CodexAuthSnapshotIndex:
    snapshots_by_account_id: dict[str, list[str]]
    active_snapshot_name: str | None


def _resolve_accounts_dir() -> Path:
    raw = os.environ.get("CODEX_AUTH_ACCOUNTS_DIR")
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".codex" / "accounts").resolve()


def _resolve_current_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_CURRENT_PATH")
    if raw:
        path = Path(raw).expanduser()
        return path if path.is_absolute() else Path.cwd() / path
    return Path.home() / ".codex" / "current"


def _resolve_active_auth_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if raw:
        path = Path(raw).expanduser()
        return path if path.is_absolute() else Path.cwd() / path
    return Path.home() / ".codex" / "auth.json"


def _snapshot_account_id(snapshot_path: Path) -> str | None:
    try:
        auth = parse_auth_json(snapshot_path.read_bytes())
    except Exception:
        return None

    claims = claims_from_auth(auth)
    email = claims.email or DEFAULT_EMAIL
    return generate_unique_account_id(claims.account_id, email)


def _resolve_active_snapshot_name(accounts_dir: Path) -> str | None:
    current_path = _resolve_current_path()
    if current_path.exists() and current_path.is_file():
        try:
            name = current_path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            name = ""
        if name:
            return name

    active_auth_path = _resolve_active_auth_path()
    if active_auth_path.exists() and active_auth_path.is_symlink():
        try:
            target = active_auth_path.resolve()
        except OSError:
            return None

        if target.suffix == ".json":
            if target.parent == accounts_dir:
                return target.stem
            return target.stem

    return None


def build_snapshot_index() -> CodexAuthSnapshotIndex:
    accounts_dir = _resolve_accounts_dir()
    snapshots_by_account_id: dict[str, list[str]] = {}

    if accounts_dir.exists() and accounts_dir.is_dir():
        for snapshot_path in sorted(accounts_dir.glob("*.json"), key=lambda path: path.name):
            account_id = _snapshot_account_id(snapshot_path)
            if not account_id:
                continue
            snapshots_by_account_id.setdefault(account_id, []).append(snapshot_path.stem)

    for snapshot_names in snapshots_by_account_id.values():
        snapshot_names.sort()

    active_snapshot_name = _resolve_active_snapshot_name(accounts_dir)
    return CodexAuthSnapshotIndex(
        snapshots_by_account_id=snapshots_by_account_id,
        active_snapshot_name=active_snapshot_name,
    )


def select_snapshot_name(snapshot_names: list[str], active_snapshot_name: str | None) -> str | None:
    if not snapshot_names:
        return None
    if active_snapshot_name and active_snapshot_name in snapshot_names:
        return active_snapshot_name
    return snapshot_names[0]


def switch_snapshot(snapshot_name: str) -> None:
    try:
        completed = subprocess.run(
            ["codex-auth", "use", snapshot_name],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError as exc:
        raise CodexAuthNotInstalledError("codex-auth is not installed. Install with: npm i -g codex-auth") from exc

    if completed.returncode == 0:
        return

    detail = (completed.stderr or completed.stdout).strip()
    if not detail:
        detail = f"exit code {completed.returncode}"
    raise CodexAuthSwitchFailedError(f"codex-auth use {snapshot_name!r} failed: {detail}")
