#!/usr/bin/env python3
"""Main.rs ownership lease helper for parallel agent safety."""

from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parent.parent
LOCK_PATH = ROOT_DIR / ".omx" / "locks" / "rust-main-rs.lock.json"
TARGET_PATH = "rust/codex-lb-runtime/src/main.rs"
DEFAULT_TTL_SECONDS = 45 * 60
PROTECTED_BRANCHES = {"dev", "main", "master"}


def now_iso(ts: float | None = None) -> str:
    timestamp = time.time() if ts is None else ts
    return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()


def load_lock() -> dict[str, Any] | None:
    if not LOCK_PATH.exists():
        return None
    try:
        return json.loads(LOCK_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return None


def lock_is_expired(lock_data: dict[str, Any], now_ts: float) -> bool:
    expires_at = lock_data.get("expires_at_epoch")
    if not isinstance(expires_at, (int, float)):
        return False
    return now_ts > float(expires_at)


def current_branch() -> str:
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=ROOT_DIR,
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return ""
    if result.returncode != 0:
        return ""
    return result.stdout.strip()


def identity(owner_arg: str | None, branch_arg: str | None) -> dict[str, Any]:
    branch = branch_arg or current_branch()
    return {
        "owner": owner_arg or os.environ.get("CODEX_THREAD_ID") or os.environ.get("USER", "unknown"),
        "owner_branch": branch,
        "owner_session_id": os.environ.get("CODEX_SESSION_ID"),
        "owner_thread_id": os.environ.get("CODEX_THREAD_ID"),
        "owner_omx_session_id": os.environ.get("OMX_SESSION_ID"),
        "host": socket.gethostname(),
        "pid": os.getpid(),
    }


def owner_matches(lock_data: dict[str, Any], ident: dict[str, Any]) -> bool:
    owner_branch = lock_data.get("owner_branch")
    ident_branch = ident.get("owner_branch")
    if owner_branch and ident_branch and owner_branch != ident_branch:
        return False

    owner = lock_data.get("owner")
    owner_session_id = lock_data.get("owner_session_id")
    owner_thread_id = lock_data.get("owner_thread_id")
    owner_omx_session_id = lock_data.get("owner_omx_session_id")

    if owner_session_id and ident.get("owner_session_id"):
        return owner_session_id == ident["owner_session_id"]
    if owner_thread_id and ident.get("owner_thread_id"):
        return owner_thread_id == ident["owner_thread_id"]
    if owner_omx_session_id and ident.get("owner_omx_session_id"):
        return owner_omx_session_id == ident["owner_omx_session_id"]
    return bool(owner and owner == ident.get("owner"))


def write_lock(lock_data: dict[str, Any], overwrite: bool) -> None:
    LOCK_PATH.parent.mkdir(parents=True, exist_ok=True)
    if not overwrite:
        with LOCK_PATH.open("x", encoding="utf-8") as f:
            json.dump(lock_data, f, indent=2, sort_keys=True)
            f.write("\n")
        return

    temp_path = LOCK_PATH.with_suffix(".tmp")
    with temp_path.open("w", encoding="utf-8") as f:
        json.dump(lock_data, f, indent=2, sort_keys=True)
        f.write("\n")
    temp_path.replace(LOCK_PATH)


def print_lock(lock_data: dict[str, Any]) -> None:
    print(json.dumps(lock_data, indent=2, sort_keys=True))


def target_is_staged() -> bool:
    result = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACMRDTUXB", "--", TARGET_PATH],
        cwd=ROOT_DIR,
        check=False,
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return False
    return bool(result.stdout.strip())


def validate_lock_for_branch(branch: str) -> tuple[bool, str]:
    lock_data = load_lock()
    if lock_data is None:
        return False, (
            "main.rs lock missing. Claim it first:\n"
            f'  python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "{branch}"'
        )

    now_ts = time.time()
    if lock_is_expired(lock_data, now_ts):
        return False, (
            "main.rs lock expired. Renew it first:\n"
            f'  python3 scripts/main_rs_lock.py claim --owner "<agent-name>" --branch "{branch}"'
        )

    owner_branch = lock_data.get("owner_branch")
    if owner_branch != branch:
        owner_label = lock_data.get("owner") or "unknown"
        return False, (
            f"main.rs lock is owned by branch '{owner_branch}' ({owner_label}).\n"
            f"Current branch: '{branch}'."
        )

    return True, ""


def claim(args: argparse.Namespace) -> int:
    ident = identity(args.owner, args.branch)
    owner_branch = str(ident.get("owner_branch") or "")
    if not owner_branch:
        print("[main-rs-lock] unable to determine current branch", file=sys.stderr)
        return 2
    if owner_branch in PROTECTED_BRANCHES and not args.allow_protected_branch:
        print(
            "[main-rs-lock] refusing to lock main.rs on a protected branch "
            f"('{owner_branch}'). Use an agent/* branch or pass --allow-protected-branch.",
            file=sys.stderr,
        )
        return 1

    now_ts = time.time()
    expires_at_ts = now_ts + args.ttl_seconds

    new_lock = {
        **ident,
        "claimed_at": now_iso(now_ts),
        "claimed_at_epoch": now_ts,
        "expires_at": now_iso(expires_at_ts),
        "expires_at_epoch": expires_at_ts,
        "lock_version": 2,
        "target_path": TARGET_PATH,
    }

    existing = load_lock()
    if existing is None:
        try:
            write_lock(new_lock, overwrite=False)
            print("[main-rs-lock] claimed new lock")
            print_lock(new_lock)
            return 0
        except FileExistsError:
            existing = load_lock() or {}

    if existing and not args.force:
        if owner_matches(existing, ident):
            write_lock(new_lock, overwrite=True)
            print("[main-rs-lock] renewed lock for same owner")
            print_lock(new_lock)
            return 0
        if not lock_is_expired(existing, now_ts):
            print("[main-rs-lock] lock is currently owned by another session", file=sys.stderr)
            print_lock(existing)
            return 1

    write_lock(new_lock, overwrite=True)
    if existing and not owner_matches(existing, ident):
        print("[main-rs-lock] took over stale/forced lock")
    else:
        print("[main-rs-lock] claimed lock")
    print_lock(new_lock)
    return 0


def release(args: argparse.Namespace) -> int:
    existing = load_lock()
    if existing is None:
        print("[main-rs-lock] no active lock")
        return 0

    ident = identity(args.owner, args.branch)
    if not args.force and not owner_matches(existing, ident):
        print("[main-rs-lock] lock release denied; owned by another session", file=sys.stderr)
        print_lock(existing)
        return 1

    try:
        LOCK_PATH.unlink(missing_ok=True)
    except OSError as err:
        print(f"[main-rs-lock] failed to release lock: {err}", file=sys.stderr)
        return 1

    print("[main-rs-lock] released lock")
    return 0


def status(_args: argparse.Namespace) -> int:
    existing = load_lock()
    if existing is None:
        print("[main-rs-lock] unlocked")
        return 0

    now_ts = time.time()
    expired = lock_is_expired(existing, now_ts)
    state = "expired" if expired else "active"
    print(f"[main-rs-lock] {state}")
    print_lock(existing)
    return 0 if not expired else 2


def validate(args: argparse.Namespace) -> int:
    branch = args.branch or current_branch()
    if not branch:
        print("[main-rs-lock] unable to determine branch for validation", file=sys.stderr)
        return 2

    if args.staged and not target_is_staged():
        return 0

    is_valid, message = validate_lock_for_branch(branch)
    if is_valid:
        return 0

    print(f"[main-rs-lock] {message}", file=sys.stderr)
    return 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Claim/release a lease lock for rust/codex-lb-runtime/src/main.rs edits."
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    claim_parser = subparsers.add_parser("claim", help="Claim or renew the main.rs lock")
    claim_parser.add_argument("--owner", help="Human-readable owner label")
    claim_parser.add_argument("--branch", help="Branch that owns the lock (default: current branch)")
    claim_parser.add_argument(
        "--ttl-seconds",
        type=int,
        default=DEFAULT_TTL_SECONDS,
        help=f"Lease duration in seconds (default: {DEFAULT_TTL_SECONDS})",
    )
    claim_parser.add_argument(
        "--allow-protected-branch",
        action="store_true",
        help="Allow claiming lock on dev/main/master (not recommended)",
    )
    claim_parser.add_argument(
        "--force",
        action="store_true",
        help="Force takeover even if lock appears active",
    )
    claim_parser.set_defaults(func=claim)

    release_parser = subparsers.add_parser("release", help="Release the main.rs lock")
    release_parser.add_argument("--owner", help="Human-readable owner label")
    release_parser.add_argument("--branch", help="Branch expected to own the lock (default: current branch)")
    release_parser.add_argument(
        "--force",
        action="store_true",
        help="Release lock even when current identity does not match owner",
    )
    release_parser.set_defaults(func=release)

    status_parser = subparsers.add_parser("status", help="Print lock status")
    status_parser.set_defaults(func=status)

    validate_parser = subparsers.add_parser("validate", help="Validate lock ownership for a branch")
    validate_parser.add_argument("--branch", help="Branch to validate (default: current branch)")
    validate_parser.add_argument(
        "--staged",
        action="store_true",
        help="Only validate when rust/codex-lb-runtime/src/main.rs is staged",
    )
    validate_parser.set_defaults(func=validate)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
