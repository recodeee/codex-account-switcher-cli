from __future__ import annotations

import argparse
import http.cookiejar
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.request import HTTPCookieProcessor, build_opener

from app.core.auth import DEFAULT_EMAIL, claims_from_auth, generate_unique_account_id, parse_auth_json
from app.modules.accounts.codex_auth_auto_import import _select_snapshot_name_for_account
from app.tools.codex_auth_switch import (
    DEFAULT_LB_URL,
    SwitchToolError,
    _ensure_dashboard_session,
    _import_account_snapshot,
    _validate_lb_url,
)


@dataclass(frozen=True, slots=True)
class _AuthIdentity:
    account_id: str
    email: str


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import all codex-auth snapshots (~/.codex/accounts/*.json) into codex-lb in one run."
    )
    parser.add_argument(
        "--lb-url",
        default=os.environ.get("CODEX_LB_URL", DEFAULT_LB_URL),
        help=f"codex-lb dashboard base URL (default: env CODEX_LB_URL or {DEFAULT_LB_URL})",
    )
    parser.add_argument(
        "--password",
        default=os.environ.get("CODEX_LB_DASHBOARD_PASSWORD"),
        help="Dashboard password if dashboard auth is enabled (or set CODEX_LB_DASHBOARD_PASSWORD)",
    )
    parser.add_argument(
        "--totp-code",
        default=os.environ.get("CODEX_LB_DASHBOARD_TOTP_CODE"),
        help="Current 6-digit TOTP code (or set CODEX_LB_DASHBOARD_TOTP_CODE)",
    )
    parser.add_argument(
        "--totp-command",
        default=os.environ.get("CODEX_LB_DASHBOARD_TOTP_COMMAND"),
        help=(
            "Command that prints the current TOTP code (fallback when --totp-code is missing). "
            "Example: 'oathtool --totp -b <SECRET>'"
        ),
    )
    parser.add_argument(
        "--accounts-dir",
        default=os.environ.get("CODEX_AUTH_ACCOUNTS_DIR"),
        help="Override snapshot directory (default: ~/.codex/accounts)",
    )
    parser.add_argument(
        "--active-auth-path",
        default=os.environ.get("CODEX_AUTH_JSON_PATH"),
        help=(
            "Path to active Codex auth JSON from `codex login` "
            "(default: ~/.codex/auth.json when it exists)"
        ),
    )
    parser.add_argument(
        "--skip-active-auth",
        action="store_true",
        help="Do not import the active ~/.codex/auth.json snapshot",
    )
    parser.add_argument(
        "--continue-on-error",
        action="store_true",
        help="Keep importing remaining snapshots even if one fails",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print snapshots that would be imported and exit",
    )
    return parser.parse_args()


def _resolve_accounts_dir(raw: str | None) -> Path:
    if raw:
        return Path(raw).expanduser().resolve()
    return (Path.home() / ".codex" / "accounts").resolve()


def _iter_snapshot_files(accounts_dir: Path) -> list[Path]:
    if not accounts_dir.exists():
        raise SwitchToolError(f"Accounts directory not found: {accounts_dir}")
    if not accounts_dir.is_dir():
        raise SwitchToolError(f"Accounts path is not a directory: {accounts_dir}")

    snapshots = sorted((p for p in accounts_dir.iterdir() if p.is_file() and p.suffix == ".json"), key=lambda p: p.name)
    return snapshots


def _iter_optional_snapshot_files(accounts_dir: Path) -> list[Path]:
    if not accounts_dir.exists():
        return []
    return _iter_snapshot_files(accounts_dir)


def _resolve_active_auth_path(raw: str | None, *, skip_active_auth: bool) -> Path | None:
    if skip_active_auth:
        return None

    if raw:
        path = Path(raw).expanduser().resolve()
        if not path.exists():
            raise SwitchToolError(f"Active auth file not found: {path}")
        if not path.is_file():
            raise SwitchToolError(f"Active auth path is not a file: {path}")
        return path

    default_path = (Path.home() / ".codex" / "auth.json").resolve()
    if not default_path.exists():
        return None
    if not default_path.is_file():
        raise SwitchToolError(f"Active auth path is not a file: {default_path}")
    return default_path


def _collect_import_sources(*, accounts_dir: Path, active_auth_path: Path | None) -> list[Path]:
    materialized_active_auth_path = _materialize_active_auth_snapshot_if_possible(
        accounts_dir=accounts_dir,
        active_auth_path=active_auth_path,
    )

    # Materialization may create/update snapshot files; re-read the list so the
    # sync source set reflects the same snapshot policy as dashboard auto-import.
    sources = _iter_optional_snapshot_files(accounts_dir)

    if materialized_active_auth_path is not None:
        snapshot_targets = {snapshot.resolve() for snapshot in sources}
        active_target = materialized_active_auth_path.resolve()
        if active_target not in snapshot_targets:
            sources.append(materialized_active_auth_path)

    return sources


def _materialize_active_auth_snapshot_if_possible(
    *,
    accounts_dir: Path,
    active_auth_path: Path | None,
) -> Path | None:
    if active_auth_path is None or not active_auth_path.exists() or not active_auth_path.is_file():
        return active_auth_path

    snapshots = _iter_optional_snapshot_files(accounts_dir)
    snapshot_targets = {snapshot.resolve() for snapshot in snapshots}
    active_target = active_auth_path.resolve()
    if active_target in snapshot_targets:
        return active_auth_path

    try:
        raw = active_auth_path.read_bytes()
    except OSError:
        return active_auth_path

    identity = _parse_auth_identity(raw)
    if identity is None:
        return active_auth_path

    snapshot_name = _select_snapshot_name_for_account(
        account_id=identity.account_id,
        email=identity.email,
        accounts_dir=accounts_dir,
    )
    if not snapshot_name:
        return active_auth_path

    snapshot_path = accounts_dir / f"{snapshot_name}.json"
    try:
        snapshot_path.parent.mkdir(parents=True, exist_ok=True)
        if snapshot_path.exists() and snapshot_path.read_bytes() == raw:
            return snapshot_path
        snapshot_path.write_bytes(raw)
    except OSError:
        return active_auth_path
    return snapshot_path


def _parse_auth_identity(raw: bytes) -> _AuthIdentity | None:
    try:
        auth = parse_auth_json(raw)
    except Exception:
        return None

    claims = claims_from_auth(auth)
    email = (claims.email or DEFAULT_EMAIL).strip().lower()
    if not email or email == DEFAULT_EMAIL:
        return None
    account_id = generate_unique_account_id(claims.account_id, email)
    return _AuthIdentity(account_id=account_id, email=email)


def main() -> int:
    args = _parse_args()

    try:
        lb_url = _validate_lb_url(args.lb_url)
        accounts_dir = _resolve_accounts_dir(args.accounts_dir)
        active_auth_path = _resolve_active_auth_path(
            args.active_auth_path,
            skip_active_auth=args.skip_active_auth,
        )
        snapshots = _collect_import_sources(accounts_dir=accounts_dir, active_auth_path=active_auth_path)

        if not snapshots:
            raise SwitchToolError(
                "No account snapshots found. Run `codex-auth save <name>` or `codex login` first."
            )

        if args.dry_run:
            print(f"Found {len(snapshots)} snapshot(s):")
            for snapshot in snapshots:
                print(f"  - {snapshot.name}")
            return 0

        cookie_jar = http.cookiejar.CookieJar()
        opener = build_opener(HTTPCookieProcessor(cookie_jar))

        _ensure_dashboard_session(
            opener=opener,
            lb_url=lb_url,
            password=args.password,
            totp_code=args.totp_code,
            totp_command=args.totp_command,
        )

        imported: list[str] = []
        failed: list[tuple[str, str]] = []

        for snapshot in snapshots:
            try:
                _import_account_snapshot(opener=opener, lb_url=lb_url, snapshot_path=snapshot)
                imported.append(snapshot.name)
                print(f"Imported: {snapshot.name}")
            except SwitchToolError as exc:
                failed.append((snapshot.name, str(exc)))
                print(f"Failed: {snapshot.name} -> {exc}", file=sys.stderr)
                if not args.continue_on_error:
                    break

        print(
            "\nBulk sync summary:\n"
            f"  imported: {len(imported)}\n"
            f"  failed: {len(failed)}\n"
            f"  codex-lb: {lb_url}\n"
            f"  source: {accounts_dir}"
        )

        if failed:
            for name, reason in failed:
                print(f"  - {name}: {reason}", file=sys.stderr)
            return 1

        return 0
    except SwitchToolError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
