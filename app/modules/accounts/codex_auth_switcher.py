from __future__ import annotations

import json
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path
from shutil import copy2
from typing import Literal

from app.core.auth import DEFAULT_EMAIL, claims_from_auth, generate_unique_account_id, parse_auth_json


class CodexAuthSnapshotNotFoundError(RuntimeError):
    """Raised when no codex-auth snapshot can be resolved for an account."""


class CodexAuthNotInstalledError(RuntimeError):
    """Raised when codex-auth CLI is unavailable on the host."""


class CodexAuthSwitchFailedError(RuntimeError):
    """Raised when codex-auth use fails for a resolved snapshot."""


class CodexAuthSnapshotConflictError(RuntimeError):
    """Raised when snapshot remediation would overwrite another account snapshot."""


class CodexAuthSnapshotRepairFailedError(RuntimeError):
    """Raised when snapshot remediation cannot complete safely."""


@dataclass(slots=True, frozen=True)
class CodexAuthSnapshotIndex:
    snapshots_by_account_id: dict[str, list[str]]
    active_snapshot_name: str | None


@dataclass(slots=True, frozen=True)
class CodexAuthSnapshotRepairResult:
    previous_snapshot_name: str
    snapshot_name: str
    mode: Literal["readd", "rename"]
    changed: bool


_INVALID_SNAPSHOT_CHARS = re.compile(r"[^a-z0-9._-]+")


def build_email_snapshot_name(email: str) -> str:
    normalized_email = email.strip().lower()
    local_part, _, domain_part = normalized_email.partition("@")
    domain_segment = domain_part.replace(".", "-") if domain_part else ""
    source = "-".join(segment for segment in (local_part, domain_segment) if segment)
    sanitized = _INVALID_SNAPSHOT_CHARS.sub("-", source).strip("._-")

    if not sanitized:
        sanitized = "account"
    if not sanitized[0].isalnum():
        sanitized = f"account-{sanitized}"

    return sanitized


def resolve_snapshot_names_for_account(
    *,
    snapshot_index: CodexAuthSnapshotIndex,
    account_id: str,
    chatgpt_account_id: str | None = None,
    email: str | None = None,
) -> list[str]:
    """Resolve candidate codex-auth snapshots for an account.

    When chatgpt_account_id + email are available, prefer lookup by their
    canonical generated account id to avoid stale persisted account.id values
    leaking snapshots from a different account after merge/overwrite flows.
    Fallback to persisted account.id only when canonical lookup resolves no
    snapshots.
    """

    resolved: list[str] = []
    seen: set[str] = set()

    def _add(snapshot_names: list[str] | None) -> None:
        if not snapshot_names:
            return
        for snapshot_name in snapshot_names:
            if snapshot_name in seen:
                continue
            seen.add(snapshot_name)
            resolved.append(snapshot_name)

    # Prefer explicit email-shaped snapshot names first. This keeps dashboard
    # mapping stable even when snapshot payload metadata drifts.
    available_snapshot_names = {
        snapshot_name
        for snapshot_names in snapshot_index.snapshots_by_account_id.values()
        for snapshot_name in snapshot_names
    }
    email_named_matches = [
        name
        for name in _email_snapshot_name_candidates(email)
        if name in available_snapshot_names
    ]
    email_named_matches.extend(
        name
        for name in _email_prefix_snapshot_name_candidates(
            email=email,
            snapshot_names=available_snapshot_names,
        )
        if name not in email_named_matches
    )
    _add(email_named_matches)

    canonical_candidate_ids: list[str] = []
    if chatgpt_account_id and email:
        normalized_email = email.strip()
        if normalized_email:
            canonical_candidate_ids.append(generate_unique_account_id(chatgpt_account_id, normalized_email))
            lowered_email = normalized_email.lower()
            if lowered_email != normalized_email:
                canonical_candidate_ids.append(generate_unique_account_id(chatgpt_account_id, lowered_email))

    deduped_candidate_ids = list(dict.fromkeys(canonical_candidate_ids))
    for candidate_account_id in deduped_candidate_ids:
        _add(snapshot_index.snapshots_by_account_id.get(candidate_account_id))

    # Compatibility fallback:
    # - no canonical candidate ids available, or
    # - canonical ids resolved no snapshots at all.
    #
    # In these cases, try persisted account.id to support legacy rows where id
    # is raw ChatGPT account id or where canonical metadata is missing.
    if not deduped_candidate_ids or not resolved:
        _add(snapshot_index.snapshots_by_account_id.get(account_id))

    return resolved


def _expected_account_ids_for_account(
    *,
    account_id: str,
    chatgpt_account_id: str | None,
    email: str | None,
) -> set[str]:
    expected_account_ids: set[str] = {account_id}
    if chatgpt_account_id and email:
        normalized_email = email.strip()
        if normalized_email:
            expected_account_ids.add(generate_unique_account_id(chatgpt_account_id, normalized_email))
            lowered_email = normalized_email.lower()
            if lowered_email != normalized_email:
                expected_account_ids.add(generate_unique_account_id(chatgpt_account_id, lowered_email))
    return expected_account_ids


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
    current_path = _resolve_current_path()
    current_snapshot_name: str | None = None
    if current_path.exists() and current_path.is_file():
        try:
            name = current_path.read_text(encoding="utf-8", errors="replace").strip()
        except OSError:
            name = ""
        current_snapshot_name = _validate_snapshot_name(name, accounts_dir=accounts_dir)

    auth_snapshot_name: str | None = None
    if active_auth_path.exists() and active_auth_path.is_symlink():
        try:
            target = active_auth_path.resolve()
        except OSError:
            target = None

        if target is not None and target.suffix == ".json":
            auth_snapshot_name = _validate_snapshot_name(target.stem, accounts_dir=accounts_dir)

    if current_snapshot_name and auth_snapshot_name:
        if current_snapshot_name == auth_snapshot_name:
            return current_snapshot_name

        current_mtime = _safe_file_mtime(current_path)
        auth_pointer_mtime = _safe_file_mtime(active_auth_path, follow_symlinks=False)
        if current_mtime > auth_pointer_mtime:
            return current_snapshot_name
        if auth_pointer_mtime > current_mtime:
            return auth_snapshot_name
        # Tie-break toward `current`, which is the user-facing selection marker.
        return current_snapshot_name

    if current_snapshot_name:
        return current_snapshot_name

    if auth_snapshot_name:
        return auth_snapshot_name

    registry_active = _resolve_active_snapshot_name_from_registry(accounts_dir)
    if registry_active:
        return registry_active

    return None


def _safe_file_mtime(path: Path, *, follow_symlinks: bool = True) -> float:
    try:
        return path.stat(follow_symlinks=follow_symlinks).st_mtime
    except OSError:
        return 0.0


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


def select_snapshot_name(
    snapshot_names: list[str],
    active_snapshot_name: str | None,
    *,
    email: str | None = None,
) -> str | None:
    if not snapshot_names:
        return None
    for candidate_name in _email_snapshot_name_candidates(email):
        if candidate_name in snapshot_names:
            return candidate_name
    for candidate_name in _email_prefix_snapshot_name_candidates(
        email=email,
        snapshot_names=set(snapshot_names),
    ):
        if candidate_name in snapshot_names:
            return candidate_name
    if active_snapshot_name and active_snapshot_name in snapshot_names:
        return active_snapshot_name
    return snapshot_names[0]


def _email_snapshot_name_candidates(email: str | None) -> list[str]:
    if not email:
        return []

    candidates = [build_email_snapshot_name(email), _canonical_snapshot_name_from_email(email)]
    deduped: list[str] = []
    seen: set[str] = set()
    for candidate in candidates:
        if not candidate or candidate in seen:
            continue
        seen.add(candidate)
        deduped.append(candidate)
    return deduped


def _email_prefix_snapshot_name_candidates(
    *,
    email: str | None,
    snapshot_names: set[str],
) -> list[str]:
    local_part = _canonical_snapshot_name_from_email(email)
    if not local_part:
        return []

    delimiters = ("-", "_", ".")
    candidates = [
        name
        for name in sorted(snapshot_names, key=lambda value: (len(value), value))
        if any(name.startswith(f"{local_part}{delimiter}") for delimiter in delimiters)
    ]
    return candidates


def _canonical_snapshot_name_from_email(email: str | None) -> str | None:
    if not email:
        return None
    local_part = email.split("@", 1)[0].strip().lower()
    if not local_part:
        return None
    sanitized = "".join(
        char if (char.isalnum() or char in {".", "_", "-"}) else "-"
        for char in local_part
    ).strip("._-")
    return sanitized or None


def repair_snapshot_for_account(
    *,
    account_id: str,
    chatgpt_account_id: str | None,
    email: str,
    mode: Literal["readd", "rename"] = "readd",
) -> CodexAuthSnapshotRepairResult:
    accounts_dir = _resolve_accounts_dir()
    snapshot_index = build_snapshot_index()
    snapshot_names = resolve_snapshot_names_for_account(
        snapshot_index=snapshot_index,
        account_id=account_id,
        chatgpt_account_id=chatgpt_account_id,
        email=email,
    )
    selected_snapshot_name = select_snapshot_name(
        snapshot_names,
        snapshot_index.active_snapshot_name,
        email=email,
    )
    if selected_snapshot_name is None:
        raise CodexAuthSnapshotNotFoundError(
            f"No codex-auth snapshot found for {email}. Run `codex-auth save <snapshot-name>` first."
        )

    source_path = accounts_dir / f"{selected_snapshot_name}.json"
    if not source_path.exists():
        raise CodexAuthSnapshotNotFoundError(
            f"Resolved snapshot {selected_snapshot_name!r} for {email} is missing on disk."
        )

    expected_account_ids = _expected_account_ids_for_account(
        account_id=account_id,
        chatgpt_account_id=chatgpt_account_id,
        email=email,
    )
    source_snapshot_account_id = _snapshot_account_id(source_path)
    source_matches_account = (
        source_snapshot_account_id is not None and source_snapshot_account_id in expected_account_ids
    )

    target_snapshot_name = build_email_snapshot_name(email)
    if target_snapshot_name == selected_snapshot_name:
        if not source_matches_account:
            raise CodexAuthSnapshotConflictError(
                f"Cannot keep snapshot {selected_snapshot_name!r} for {email}: snapshot belongs to a different account."
            )
        try:
            _switch_snapshot_without_cli(target_snapshot_name)
        except Exception as exc:
            raise CodexAuthSnapshotRepairFailedError(
                f"Snapshot {target_snapshot_name!r} is already aligned but pointer refresh failed: {exc}"
            ) from exc
        return CodexAuthSnapshotRepairResult(
            previous_snapshot_name=selected_snapshot_name,
            snapshot_name=target_snapshot_name,
            mode=mode,
            changed=False,
        )

    target_path = accounts_dir / f"{target_snapshot_name}.json"
    if target_path.exists():
        raise CodexAuthSnapshotConflictError(
            f"Cannot {mode} snapshot {selected_snapshot_name!r} to {target_snapshot_name!r}: target already exists."
        )

    try:
        if mode == "readd":
            copy2(source_path, target_path)
        else:
            source_path.rename(target_path)
    except OSError as exc:
        raise CodexAuthSnapshotRepairFailedError(
            f"Failed to {mode} snapshot {selected_snapshot_name!r} to {target_snapshot_name!r}: {exc}"
        ) from exc

    try:
        _switch_snapshot_without_cli(target_snapshot_name)
    except Exception as exc:
        raise CodexAuthSnapshotRepairFailedError(
            f"Snapshot {target_snapshot_name!r} {mode} succeeded but activation failed: {exc}"
        ) from exc

    return CodexAuthSnapshotRepairResult(
        previous_snapshot_name=selected_snapshot_name,
        snapshot_name=target_snapshot_name,
        mode=mode,
        changed=True,
    )


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
    _set_registry_active_snapshot(snapshot_name, accounts_dir=accounts_dir)


def _replace_auth_pointer(active_auth_path: Path, snapshot_path: Path) -> None:
    if active_auth_path.is_symlink() or active_auth_path.exists():
        active_auth_path.unlink()
    try:
        relative_target = Path(os.path.relpath(snapshot_path, start=active_auth_path.parent))
        active_auth_path.symlink_to(relative_target)
    except (OSError, ValueError):
        active_auth_path.write_bytes(snapshot_path.read_bytes())


def _set_registry_active_snapshot(snapshot_name: str, *, accounts_dir: Path) -> None:
    registry_path = _resolve_registry_path(accounts_dir)
    payload: dict[str, object]

    if registry_path.exists() and registry_path.is_file():
        try:
            decoded = json.loads(registry_path.read_text(encoding="utf-8", errors="replace"))
        except (OSError, ValueError, TypeError):
            decoded = {}
        payload = decoded if isinstance(decoded, dict) else {}
    else:
        payload = {}

    payload["activeAccountName"] = snapshot_name
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    registry_path.write_text(f"{json.dumps(payload, indent=2)}\n", encoding="utf-8")


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
