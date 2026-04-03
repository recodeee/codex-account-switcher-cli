from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import sys
import time
from collections import Counter, deque
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal


_ROLLOUT_FILENAME_RE = re.compile(
    r"^rollout-(?P<start>\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})-(?P<session>[0-9a-fA-F-]{36})\.jsonl$"
)
_PS_LINE_RE = re.compile(
    r"^\s*(?P<pid>\d+)\s+(?P<lstart>[A-Za-z]{3}\s+[A-Za-z]{3}\s+\d+\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+(?P<cmd>.*)$"
)
_DEFAULT_MAX_SKEW_SECONDS = 300
_DEFAULT_AMBIGUITY_WINDOW_SECONDS = 15
_DEFAULT_GRACE_SECONDS = 10
_DEFAULT_MAX_TARGETS = 20
_TAIL_LINE_LIMIT = 400


class ReconcileToolError(RuntimeError):
    """Raised when safe session reconciliation cannot proceed."""


@dataclass(slots=True, frozen=True)
class SessionFingerprint:
    primary_reset_at: int | None
    secondary_reset_at: int | None
    plan_type: str | None


@dataclass(slots=True, frozen=True)
class RolloutSession:
    session_id: str
    path: Path
    start_ts: float
    fingerprint: SessionFingerprint | None


MappingState = Literal["mapped", "unknown", "ambiguous"]
Decision = Literal[
    "keep",
    "match",
    "restart",
    "skipped_unknown",
    "skipped_ambiguous",
    "skipped_out_of_scope",
    "skipped_self",
]


@dataclass(slots=True)
class RunningProcess:
    pid: int
    cmd: str
    start_ts: float
    cwd: Path | None
    session_id: str | None = None
    fingerprint: SessionFingerprint | None = None
    mapping_state: MappingState = "unknown"
    decision: Decision = "skipped_unknown"
    reason: str = ""


def _to_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _extract_latest_fingerprint(path: Path) -> SessionFingerprint | None:
    tail: deque[str] = deque(maxlen=_TAIL_LINE_LIMIT)
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                tail.append(line)
    except OSError:
        return None

    for raw_line in reversed(tail):
        line = raw_line.strip()
        if not line:
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(payload, dict):
            continue

        event_payload = payload.get("payload")
        if not isinstance(event_payload, dict):
            continue
        if event_payload.get("type") != "token_count":
            continue

        rate_limits = event_payload.get("rate_limits")
        if not isinstance(rate_limits, dict):
            continue

        primary = rate_limits.get("primary") if isinstance(rate_limits.get("primary"), dict) else {}
        secondary = rate_limits.get("secondary") if isinstance(rate_limits.get("secondary"), dict) else {}
        fingerprint = SessionFingerprint(
            primary_reset_at=_to_int(primary.get("resets_at")),
            secondary_reset_at=_to_int(secondary.get("resets_at")),
            plan_type=rate_limits.get("plan_type") if isinstance(rate_limits.get("plan_type"), str) else None,
        )
        if (
            fingerprint.primary_reset_at is None
            and fingerprint.secondary_reset_at is None
            and fingerprint.plan_type is None
        ):
            return None
        return fingerprint

    return None


def _discover_rollout_sessions(root: Path) -> list[RolloutSession]:
    sessions: list[RolloutSession] = []
    if not root.exists() or not root.is_dir():
        return sessions

    for path in sorted(root.rglob("rollout-*.jsonl"), key=lambda entry: entry.stat().st_mtime, reverse=True):
        parsed = _parse_rollout_filename(path)
        if parsed is None:
            continue
        session_id, start_ts = parsed
        sessions.append(
            RolloutSession(
                session_id=session_id,
                path=path,
                start_ts=start_ts,
                fingerprint=_extract_latest_fingerprint(path),
            )
        )
    return sessions


def _parse_rollout_filename(path: Path) -> tuple[str, float] | None:
    match = _ROLLOUT_FILENAME_RE.match(path.name)
    if match is None:
        return None
    try:
        start_dt = datetime.strptime(match.group("start"), "%Y-%m-%dT%H-%M-%S")
    except ValueError:
        return None
    return match.group("session"), start_dt.timestamp()


def _is_codex_session_command(command: str) -> bool:
    return "--dangerously-bypass-approvals-and-sandbox" in command and "model_instructions_file=" in command


def _resolve_pid_cwd(pid: int) -> Path | None:
    try:
        return Path(os.readlink(f"/proc/{pid}/cwd")).resolve()
    except OSError:
        return None


def _list_running_codex_processes() -> list[RunningProcess]:
    completed = subprocess.run(
        ["ps", "-eo", "pid,lstart,cmd", "--no-headers", "--sort=start_time"],
        check=False,
        capture_output=True,
        text=True,
    )
    if completed.returncode != 0:
        raise ReconcileToolError(f"Failed to list processes with ps (exit {completed.returncode})")

    processes: list[RunningProcess] = []
    for line in completed.stdout.splitlines():
        match = _PS_LINE_RE.match(line)
        if match is None:
            continue
        cmd = match.group("cmd")
        if not _is_codex_session_command(cmd):
            continue
        try:
            start_ts = datetime.strptime(match.group("lstart"), "%a %b %d %H:%M:%S %Y").timestamp()
        except ValueError:
            continue
        pid = int(match.group("pid"))
        processes.append(
            RunningProcess(
                pid=pid,
                cmd=cmd,
                start_ts=start_ts,
                cwd=_resolve_pid_cwd(pid),
            )
        )

    return processes


def _match_rollout_for_process(
    process: RunningProcess,
    rollouts: list[RolloutSession],
    *,
    max_skew_seconds: int = _DEFAULT_MAX_SKEW_SECONDS,
    ambiguity_window_seconds: int = _DEFAULT_AMBIGUITY_WINDOW_SECONDS,
) -> tuple[MappingState, RolloutSession | None]:
    candidates = [
        rollout for rollout in rollouts if abs(rollout.start_ts - process.start_ts) <= max_skew_seconds
    ]
    if not candidates:
        return "unknown", None

    ranked = sorted(candidates, key=lambda rollout: abs(rollout.start_ts - process.start_ts))
    if len(ranked) >= 2:
        first_delta = abs(ranked[0].start_ts - process.start_ts)
        second_delta = abs(ranked[1].start_ts - process.start_ts)
        if (second_delta - first_delta) <= ambiguity_window_seconds:
            return "ambiguous", None

    return "mapped", ranked[0]


def _is_repo_scoped(cwd: Path | None, repo_root: Path) -> bool:
    if cwd is None:
        return False
    try:
        cwd.resolve().relative_to(repo_root.resolve())
        return True
    except ValueError:
        return False


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _send_signal(pid: int, sig: signal.Signals) -> None:
    try:
        pgid = os.getpgid(pid)
    except ProcessLookupError:
        return

    if hasattr(os, "killpg"):
        try:
            os.killpg(pgid, sig)
            return
        except ProcessLookupError:
            return
        except PermissionError:
            pass

    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        return


def _restart_process(pid: int, grace_seconds: int) -> tuple[bool, bool]:
    _send_signal(pid, signal.SIGTERM)
    deadline = time.monotonic() + max(1, grace_seconds)
    while time.monotonic() < deadline:
        if not _is_pid_alive(pid):
            return True, False
        time.sleep(0.2)

    if _is_pid_alive(pid):
        _send_signal(pid, signal.SIGKILL)
        time.sleep(0.1)
    return not _is_pid_alive(pid), True


def _resolve_sessions_dir(raw: str | None) -> Path:
    if raw:
        return Path(raw).expanduser().resolve()
    env = os.environ.get("CODEX_SESSIONS_DIR")
    if env:
        return Path(env).expanduser().resolve()
    return (Path.home() / ".codex" / "sessions").resolve()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Safely reconcile running Codex sessions by restarting only sessions that do not match a keep-session "
            "rate-limit fingerprint."
        )
    )
    parser.add_argument("--keep-session-id", required=True, help="Session ID to keep as reference fingerprint")
    parser.add_argument("--apply", action="store_true", help="Apply restarts (default is dry-run only)")
    parser.add_argument(
        "--scope",
        choices=["repo", "all"],
        default="repo",
        help="Target scope: current repository only or all local sessions (default: repo)",
    )
    parser.add_argument(
        "--grace-seconds",
        type=int,
        default=_DEFAULT_GRACE_SECONDS,
        help=f"Seconds to wait after SIGTERM before SIGKILL (default: {_DEFAULT_GRACE_SECONDS})",
    )
    parser.add_argument(
        "--max-targets",
        type=int,
        default=_DEFAULT_MAX_TARGETS,
        help=f"Safety limit for restart candidates (default: {_DEFAULT_MAX_TARGETS})",
    )
    parser.add_argument("--sessions-dir", help="Override codex sessions directory")
    parser.add_argument("--json", action="store_true", help="Output machine-readable JSON report")
    return parser.parse_args()


def _validate_args(args: argparse.Namespace) -> None:
    if not re.match(r"^[0-9a-fA-F-]{36}$", args.keep_session_id):
        raise ReconcileToolError("--keep-session-id must be a UUID-style session identifier")
    if args.grace_seconds < 1:
        raise ReconcileToolError("--grace-seconds must be >= 1")
    if args.max_targets < 1:
        raise ReconcileToolError("--max-targets must be >= 1")


def _build_decisions(
    processes: list[RunningProcess],
    rollouts: list[RolloutSession],
    *,
    keep_session_id: str,
    scope: Literal["repo", "all"],
    repo_root: Path,
) -> tuple[list[RunningProcess], SessionFingerprint]:
    rollout_by_id = {rollout.session_id: rollout for rollout in rollouts}
    keep_rollout = rollout_by_id.get(keep_session_id)
    if keep_rollout is None or keep_rollout.fingerprint is None:
        raise ReconcileToolError(
            "Keep session fingerprint could not be resolved from rollout logs. "
            "Use a valid running session ID with recent token_count data."
        )

    keep_fingerprint = keep_rollout.fingerprint
    self_pids = {os.getpid(), os.getppid()}

    for process in processes:
        if process.pid in self_pids:
            process.decision = "skipped_self"
            process.reason = "self-process protection"
            continue

        if scope == "repo" and not _is_repo_scoped(process.cwd, repo_root):
            process.decision = "skipped_out_of_scope"
            process.reason = "process cwd is outside repo scope"
            continue

        state, rollout = _match_rollout_for_process(process, rollouts)
        process.mapping_state = state
        if state != "mapped" or rollout is None:
            process.decision = "skipped_ambiguous" if state == "ambiguous" else "skipped_unknown"
            process.reason = "session mapping is ambiguous" if state == "ambiguous" else "session mapping not found"
            continue

        process.session_id = rollout.session_id
        process.fingerprint = rollout.fingerprint
        if process.fingerprint is None:
            process.decision = "skipped_unknown"
            process.reason = "fingerprint missing for mapped session"
            continue

        if process.session_id == keep_session_id:
            process.decision = "keep"
            process.reason = "reference keep session"
        elif process.fingerprint == keep_fingerprint:
            process.decision = "match"
            process.reason = "fingerprint matches keep session"
        else:
            process.decision = "restart"
            process.reason = "fingerprint differs from keep session"

    in_scope_processes = [
        process
        for process in processes
        if not (scope == "repo" and process.decision == "skipped_out_of_scope")
    ]
    if not any(process.decision == "keep" for process in in_scope_processes):
        raise ReconcileToolError("Keep session is not present in the selected scope of running processes")

    return processes, keep_fingerprint


def _render_fingerprint(fingerprint: SessionFingerprint | None) -> str:
    if fingerprint is None:
        return "(none)"
    return (
        f"primary_reset={fingerprint.primary_reset_at},"
        f"secondary_reset={fingerprint.secondary_reset_at},"
        f"plan={fingerprint.plan_type}"
    )


def _print_human_report(processes: list[RunningProcess], *, applied: bool) -> None:
    counts = Counter(process.decision for process in processes)
    print(f"mode: {'apply' if applied else 'dry-run'}")
    print(
        "summary: "
        + ", ".join(
            f"{name}={counts.get(name, 0)}"
            for name in [
                "keep",
                "match",
                "restart",
                "skipped_unknown",
                "skipped_ambiguous",
                "skipped_out_of_scope",
                "skipped_self",
            ]
        )
    )
    for process in processes:
        fingerprint = _render_fingerprint(process.fingerprint)
        cwd = str(process.cwd) if process.cwd is not None else "(unknown)"
        session = process.session_id or "(unknown)"
        print(
            f"pid={process.pid} decision={process.decision} session={session} "
            f"cwd={cwd} fingerprint={fingerprint} reason={process.reason}"
        )


def _print_json_report(
    processes: list[RunningProcess],
    *,
    applied: bool,
    keep_session_id: str,
    keep_fingerprint: SessionFingerprint,
) -> None:
    counts = Counter(process.decision for process in processes)
    payload = {
        "mode": "apply" if applied else "dry-run",
        "keepSessionId": keep_session_id,
        "keepFingerprint": asdict(keep_fingerprint),
        "summary": dict(counts),
        "processes": [
            {
                "pid": process.pid,
                "sessionId": process.session_id,
                "cwd": str(process.cwd) if process.cwd is not None else None,
                "mappingState": process.mapping_state,
                "fingerprint": asdict(process.fingerprint) if process.fingerprint is not None else None,
                "decision": process.decision,
                "reason": process.reason,
            }
            for process in processes
        ],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))


def main() -> int:
    args = _parse_args()
    try:
        _validate_args(args)
        repo_root = Path.cwd().resolve()
        sessions_dir = _resolve_sessions_dir(args.sessions_dir)
        rollouts = _discover_rollout_sessions(sessions_dir)
        if not rollouts:
            raise ReconcileToolError(f"No rollout session logs found under {sessions_dir}")

        processes = _list_running_codex_processes()
        if not processes:
            raise ReconcileToolError("No running Codex sessions were detected")

        decisions, keep_fingerprint = _build_decisions(
            processes,
            rollouts,
            keep_session_id=args.keep_session_id,
            scope=args.scope,
            repo_root=repo_root,
        )

        restart_targets = [process for process in decisions if process.decision == "restart"]
        if len(restart_targets) > args.max_targets:
            raise ReconcileToolError(
                f"Restart target count ({len(restart_targets)}) exceeds --max-targets ({args.max_targets})"
            )

        if args.apply:
            for process in restart_targets:
                terminated, forced = _restart_process(process.pid, args.grace_seconds)
                if terminated:
                    process.reason = (
                        "restarted (required SIGKILL)" if forced else "restarted (terminated gracefully)"
                    )
                else:
                    process.reason = "restart attempted but process is still running"

        if args.json:
            _print_json_report(
                decisions,
                applied=args.apply,
                keep_session_id=args.keep_session_id,
                keep_fingerprint=keep_fingerprint,
            )
        else:
            _print_human_report(decisions, applied=args.apply)
        return 0
    except ReconcileToolError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
