from __future__ import annotations

import json
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


def _resolve_registry_path(accounts_dir: Path) -> Path:
    raw = os.environ.get("CODEX_AUTH_REGISTRY_PATH")
    if raw:
        path = Path(raw).expanduser()
        return path if path.is_absolute() else Path.cwd() / path
    return accounts_dir / "registry.json"


def _validate_snapshot_name(snapshot_name: str | None, *, accounts_dir: Path) -> str | None:
    if not snapshot_name:
        return None
    name = snapshot_name.strip()
    if not name:
        return None
    if (accounts_dir / f"{name}.json").exists():
        return name
    return None


def _resolve_active_snapshot_name_from_registry(accounts_dir: Path) -> str | None:
    registry_path = _resolve_registry_path(accounts_dir)
    if not registry_path.exists() or not registry_path.is_file():
        return None

    try:
        payload = json.loads(registry_path.read_text(encoding="utf-8", errors="replace"))
    except (OSError, ValueError, TypeError):
        return None

    if not isinstance(payload, dict):
        return None

    active_name = payload.get("activeAccountName")
    if not isinstance(active_name, str):
        return None

    return _validate_snapshot_name(active_name, accounts_dir=accounts_dir)


def _snapshot_account_id(snapshot_path: Path) -> str | None:
    try:
        auth = parse_auth_json(snapshot_path.read_bytes())
    except Exception:
        return None

    claims = claims_from_auth(auth)
    email = claims.email or DEFAULT_EMAIL
    return generate_unique_account_id(claims.account_id, email)


def _resolve_active_snapshot_name(accounts_dir: Path) -> str | None:
    active_auth_path = _resolve_active_auth_path()
    if active_auth_path.exists() and active_auth_path.is_symlink():
        try:
            target = active_auth_path.resolve()
        except OSError:
            target = None

        if target is not None and target.suffix == ".json":
            resolved = _validate_snapshot_name(target.stem, accounts_dir=accounts_dir)
            if resolved:
                return resolved

    current_path = _resolve_current_path()
    if current_path.exists() and current_path.is_file():
        try:
            name = current_path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            name = ""
        resolved = _validate_snapshot_name(name, accounts_dir=accounts_dir)
        if resolved:
            return resolved

    registry_active = _resolve_active_snapshot_name_from_registry(accounts_dir)
    if registry_active:
        return registry_active

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


def _switch_snapshot_without_cli(snapshot_name: str) -> None:
    accounts_dir = _resolve_accounts_dir()
    snapshot_path = accounts_dir / f"{snapshot_name}.json"
    if not snapshot_path.exists():
        raise CodexAuthSwitchFailedError(
            f"codex-auth snapshot {snapshot_name!r} was not found at {snapshot_path}"
        )

    current_path = _resolve_current_path()
    current_path.parent.mkdir(parents=True, exist_ok=True)
    current_path.write_text(f"{snapshot_name}\n", encoding="utf-8")

    active_auth_path = _resolve_active_auth_path()
    active_auth_path.parent.mkdir(parents=True, exist_ok=True)
    _replace_auth_pointer(active_auth_path, snapshot_path)


def _replace_auth_pointer(active_auth_path: Path, snapshot_path: Path) -> None:
    if active_auth_path.is_symlink() or active_auth_path.exists():
        active_auth_path.unlink()
    try:
        relative_target = Path(os.path.relpath(snapshot_path, start=active_auth_path.parent))
        active_auth_path.symlink_to(relative_target)
    except (OSError, ValueError):
        active_auth_path.write_bytes(snapshot_path.read_bytes())


def switch_snapshot(snapshot_name: str) -> None:
    try:
        completed = subprocess.run(
            ["codex-auth", "use", snapshot_name],
            check=False,
            capture_output=True,
            text=True,
        )
    except FileNotFoundError:
        try:
            _switch_snapshot_without_cli(snapshot_name)
            return
        except Exception as fallback_exc:
            raise CodexAuthNotInstalledError(
                "codex-auth is not installed. Install with: npm i -g codex-auth"
            ) from fallback_exc

    if completed.returncode == 0:
        # Always normalize pointers after a successful CLI switch so the active
        # auth path remains host-valid even when codex-auth executed in a
        # different filesystem namespace (for example /home/app in Docker).
        try:
            _switch_snapshot_without_cli(snapshot_name)
        except Exception as repair_exc:
            raise CodexAuthSwitchFailedError(
                f"codex-auth use {snapshot_name!r} succeeded but auth pointer repair failed: {repair_exc}"
            ) from repair_exc
        return

    detail = (completed.stderr or completed.stdout).strip()
    if not detail:
        detail = f"exit code {completed.returncode}"
    raise CodexAuthSwitchFailedError(f"codex-auth use {snapshot_name!r} failed: {detail}")
