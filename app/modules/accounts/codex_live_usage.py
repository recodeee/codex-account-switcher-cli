from __future__ import annotations

import json
import os
import re
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal

from app.modules.accounts.codex_auth_switcher import build_snapshot_index


_DEFAULT_ACTIVE_WINDOW_SECONDS = 300
_DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS = 60
_TAIL_LINE_LIMIT = 400
_FALLBACK_SCAN_LIMIT = 200
_ROLLOUT_SESSION_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$")
_RESET_AT_MATCH_TOLERANCE_SECONDS = 30


@dataclass(frozen=True)
class LocalUsageWindow:
    used_percent: float
    reset_at: int | None
    window_minutes: int | None


@dataclass(frozen=True)
class LocalCodexLiveUsage:
    recorded_at: datetime
    active_session_count: int
    primary: LocalUsageWindow | None
    secondary: LocalUsageWindow | None


@dataclass(frozen=True)
class LocalCodexLiveUsageSample:
    source: str
    recorded_at: datetime
    primary: LocalUsageWindow | None
    secondary: LocalUsageWindow | None
    stale: bool = False


def read_local_codex_live_usage(*, now: datetime | None = None) -> LocalCodexLiveUsage | None:
    current = now or datetime.now(timezone.utc)
    sessions_dir = _resolve_sessions_dir()
    return _read_local_codex_live_usage_for_sessions_dir(sessions_dir=sessions_dir, now=current)


def read_local_codex_live_usage_samples(*, now: datetime | None = None) -> list[LocalCodexLiveUsage]:
    current = now or datetime.now(timezone.utc)
    sessions_dir = _resolve_sessions_dir()
    return _read_local_codex_live_usage_samples_for_sessions_dir(sessions_dir=sessions_dir, now=current)


def read_local_codex_live_usage_by_snapshot(*, now: datetime | None = None) -> dict[str, LocalCodexLiveUsage]:
    current = now or datetime.now(timezone.utc)
    usage_by_snapshot: dict[str, LocalCodexLiveUsage] = {}

    active_snapshot_name = build_snapshot_index().active_snapshot_name
    if active_snapshot_name:
        default_usage = _read_local_codex_live_usage_for_sessions_dir(
            sessions_dir=_resolve_sessions_dir(),
            now=current,
            aggregation_mode="latest",
        )
        if default_usage is not None:
            usage_by_snapshot[active_snapshot_name] = default_usage

    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return usage_by_snapshot

    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        runtime_usage = _read_local_codex_live_usage_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
            aggregation_mode="max_used",
        )
        if runtime_usage is None:
            continue

        previous = usage_by_snapshot.get(snapshot_name)
        usage_by_snapshot[snapshot_name] = _merge_live_usage(previous, runtime_usage)

    return usage_by_snapshot


def read_local_codex_live_usage_samples_by_snapshot(
    *,
    now: datetime | None = None,
) -> dict[str, list[LocalCodexLiveUsageSample]]:
    current = now or datetime.now(timezone.utc)
    samples_by_snapshot: dict[str, list[LocalCodexLiveUsageSample]] = {}

    active_snapshot_name = build_snapshot_index().active_snapshot_name
    if active_snapshot_name:
        default_samples = _read_local_codex_live_usage_sample_entries_for_sessions_dir(
            sessions_dir=_resolve_sessions_dir(),
            now=current,
        )
        if default_samples:
            samples_by_snapshot[active_snapshot_name] = default_samples

    runtime_root = _resolve_runtime_root()
    if not runtime_root.exists() or not runtime_root.is_dir():
        return samples_by_snapshot

    for runtime_dir in runtime_root.iterdir():
        if not runtime_dir.is_dir():
            continue

        snapshot_name = _read_runtime_current_snapshot(runtime_dir)
        if not snapshot_name:
            continue

        runtime_samples = _read_local_codex_live_usage_sample_entries_for_sessions_dir(
            sessions_dir=runtime_dir / "sessions",
            now=current,
        )
        if not runtime_samples:
            continue

        samples_by_snapshot.setdefault(snapshot_name, []).extend(runtime_samples)

    return samples_by_snapshot


def read_live_codex_process_session_counts_by_snapshot() -> dict[str, int]:
    proc_root = Path("/proc")
    if not proc_root.exists() or not proc_root.is_dir():
        return {}

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    counts: dict[str, int] = {}

    for pid, _command in _iter_running_codex_commands(proc_root):
        snapshot_name = _resolve_process_snapshot_name(
            pid,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )
        if not snapshot_name:
            continue
        counts[snapshot_name] = counts.get(snapshot_name, 0) + 1

    return counts


def has_recent_active_snapshot_process_fallback(*, now: datetime | None = None) -> bool:
    current = now or datetime.now(timezone.utc)
    if not _active_snapshot_selection_changed_recently(current):
        return False
    return _has_running_default_scope_codex_process()


def _read_local_codex_live_usage_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
    aggregation_mode: Literal["latest", "max_used"] = "latest",
) -> LocalCodexLiveUsage | None:
    active_window_seconds = _active_window_seconds()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return None

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return None

    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return None

    if aggregation_mode == "max_used":
        latest = _extract_max_used_rate_limit_from_paths(
            _prefer_newest_sessions(active_files),
            now=now,
        )
    else:
        latest = _extract_latest_rate_limit_from_paths(_prefer_newest_sessions(active_files))
    if latest is None:
        # A newly started session can be active before it emits its first token_count
        # event. In that case, fall back to the most recent known rate-limit payload
        # from nearby rollout files so the dashboard does not remain stuck at stale
        # values until the first prompt is sent.
        latest = _extract_latest_rate_limit_from_paths(_prefer_newest_sessions(candidates))

    if latest is None:
        return LocalCodexLiveUsage(
            recorded_at=now,
            active_session_count=len(active_files),
            primary=None,
            secondary=None,
        )

    recorded_at, primary, secondary = latest
    return LocalCodexLiveUsage(
        recorded_at=recorded_at,
        active_session_count=len(active_files),
        primary=primary,
        secondary=secondary,
    )


def _read_local_codex_live_usage_samples_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
) -> list[LocalCodexLiveUsage]:
    active_window_seconds = _active_window_seconds()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return []

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return []

    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return []

    samples: list[LocalCodexLiveUsage] = []
    sample_cutoff = now - timedelta(seconds=active_window_seconds)
    for path in _prefer_newest_sessions(active_files):
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is None:
            mtime = _safe_mtime(path)
            recorded_at = datetime.fromtimestamp(mtime, tz=timezone.utc) if mtime > 0 else now
            samples.append(
                LocalCodexLiveUsage(
                    recorded_at=recorded_at,
                    active_session_count=1,
                    primary=None,
                    secondary=None,
                )
            )
            continue

        recorded_at, primary, secondary = snapshot
        if recorded_at < sample_cutoff:
            # A session file can still be "active" by mtime while its latest
            # token_count payload is stale (for example, non-token events update
            # mtime). Keep presence-only telemetry for session counting, but do
            # not expose stale quota fingerprints that would be mis-attributed
            # across multiple accounts in mixed default-session matching.
            samples.append(
                LocalCodexLiveUsage(
                    recorded_at=recorded_at,
                    active_session_count=1,
                    primary=None,
                    secondary=None,
                )
            )
            continue

        samples.append(
            LocalCodexLiveUsage(
                recorded_at=recorded_at,
                active_session_count=1,
                primary=primary,
                secondary=secondary,
            )
        )

    return samples


def _read_local_codex_live_usage_sample_entries_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
) -> list[LocalCodexLiveUsageSample]:
    active_window_seconds = _active_window_seconds()
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return []

    candidates = _candidate_rollout_files(sessions_dir, now)
    if not candidates:
        return []

    cutoff_ts = (now - timedelta(seconds=active_window_seconds)).timestamp()
    active_files = [path for path in candidates if _safe_mtime(path) >= cutoff_ts]
    if not active_files:
        return []

    samples: list[LocalCodexLiveUsageSample] = []
    sample_cutoff = now - timedelta(seconds=active_window_seconds)
    for path in _prefer_newest_sessions(active_files):
        source = str(path)
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is None:
            mtime = _safe_mtime(path)
            recorded_at = datetime.fromtimestamp(mtime, tz=timezone.utc) if mtime > 0 else now
            samples.append(
                LocalCodexLiveUsageSample(
                    source=source,
                    recorded_at=recorded_at,
                    primary=None,
                    secondary=None,
                    stale=False,
                )
            )
            continue

        recorded_at, primary, secondary = snapshot
        samples.append(
            LocalCodexLiveUsageSample(
                source=source,
                recorded_at=recorded_at,
                primary=primary,
                secondary=secondary,
                stale=recorded_at < sample_cutoff,
            )
        )

    return samples


def _merge_live_usage(
    previous: LocalCodexLiveUsage | None,
    current: LocalCodexLiveUsage,
) -> LocalCodexLiveUsage:
    if previous is None:
        return current

    prefer_current = current.recorded_at >= previous.recorded_at
    preferred = current if prefer_current else previous
    fallback = previous if prefer_current else current

    return LocalCodexLiveUsage(
        recorded_at=max(previous.recorded_at, current.recorded_at),
        active_session_count=max(0, previous.active_session_count) + max(0, current.active_session_count),
        primary=_merge_usage_windows(
            previous=preferred.primary,
            current=fallback.primary,
            preferred_recorded_at=preferred.recorded_at,
            fallback_recorded_at=fallback.recorded_at,
            now=max(previous.recorded_at, current.recorded_at),
            prefer_max_used_within_cycle=True,
        ),
        secondary=_merge_usage_windows(
            previous=preferred.secondary,
            current=fallback.secondary,
            preferred_recorded_at=preferred.recorded_at,
            fallback_recorded_at=fallback.recorded_at,
            now=max(previous.recorded_at, current.recorded_at),
            prefer_max_used_within_cycle=True,
        ),
    )


def _prefer_newest_sessions(paths: list[Path]) -> list[Path]:
    return sorted(
        paths,
        key=lambda path: (_session_start_sort_key(path), _safe_mtime(path)),
        reverse=True,
    )


def _session_start_sort_key(path: Path) -> str:
    # rollout-<local-session-start>-<session-id>.jsonl
    # Example: rollout-2026-04-03T16-22-44-019d53...
    name = path.name
    if not name.startswith("rollout-"):
        return ""
    key = name.removeprefix("rollout-")
    # 19 chars: YYYY-MM-DDTHH-MM-SS
    if len(key) >= 19:
        prefix = key[:19]
        if _ROLLOUT_SESSION_PREFIX_RE.match(prefix):
            return prefix
    return ""


def _active_window_seconds() -> int:
    raw = os.environ.get("CODEX_LB_LOCAL_SESSION_ACTIVE_SECONDS")
    if raw is None:
        return _DEFAULT_ACTIVE_WINDOW_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_ACTIVE_WINDOW_SECONDS
    return max(60, value)


def _resolve_sessions_dir() -> Path:
    sessions_raw = os.environ.get("CODEX_SESSIONS_DIR")
    if sessions_raw:
        return _resolve_path(sessions_raw)

    auth_raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if auth_raw:
        auth_path = _resolve_path(auth_raw)
        return auth_path.parent / "sessions"

    return (Path.home() / ".codex" / "sessions").resolve()


def _resolve_runtime_root() -> Path:
    raw = os.environ.get("CODEX_AUTH_RUNTIME_ROOT")
    if raw:
        return _resolve_path(raw)
    return (Path.home() / ".codex" / "runtimes").resolve()


def _resolve_current_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_CURRENT_PATH")
    if raw:
        return _resolve_path(raw)
    return (Path.home() / ".codex" / "current").resolve()


def _resolve_auth_path() -> Path:
    raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if raw:
        return _resolve_path(raw)
    return (Path.home() / ".codex" / "auth.json").resolve()


def _read_runtime_current_snapshot(runtime_dir: Path) -> str | None:
    current_path = runtime_dir / "current"
    return _read_snapshot_name_from_current_path(current_path)


def _read_snapshot_name_from_current_path(current_path: Path) -> str | None:
    if not current_path.exists() or not current_path.is_file():
        return None
    try:
        value = current_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    return value or None


def _resolve_path(raw: str) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = Path.cwd() / path
    return path.resolve()


def _active_snapshot_selection_changed_recently(now: datetime) -> bool:
    current_path = _resolve_current_path()
    if not current_path.exists() or not current_path.is_file():
        return False

    changed_at = _safe_mtime(current_path)
    if changed_at <= 0:
        return False

    age_seconds = max(0.0, now.timestamp() - changed_at)
    return age_seconds <= _switch_process_fallback_seconds()


def _switch_process_fallback_seconds() -> int:
    raw = os.environ.get("CODEX_LB_SWITCH_SESSION_FALLBACK_SECONDS")
    if raw is None:
        return _DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS
    try:
        value = int(raw)
    except ValueError:
        return _DEFAULT_SWITCH_PROCESS_FALLBACK_SECONDS
    return max(30, value)


def _has_running_default_scope_codex_process() -> bool:
    proc_root = Path("/proc")
    if not proc_root.exists() or not proc_root.is_dir():
        return False

    default_current_path = _resolve_current_path()
    default_auth_path = _resolve_auth_path()
    for pid, command in _iter_running_codex_commands(proc_root):
        if _is_non_default_auth_scope_process(
            pid,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        ):
            continue
        snapshot_name = _resolve_process_snapshot_name(
            pid,
            default_current_path=default_current_path,
            default_auth_path=default_auth_path,
        )
        if not snapshot_name:
            continue
        if command:
            return True
    return False


def _resolve_process_snapshot_name(
    pid: int,
    *,
    default_current_path: Path,
    default_auth_path: Path,
) -> str | None:
    env = _read_process_env(pid)
    if not env:
        return None

    explicit_snapshot = env.get("CODEX_AUTH_ACTIVE_SNAPSHOT", "").strip()
    if explicit_snapshot:
        return explicit_snapshot

    current_override = _resolve_process_path(env.get("CODEX_AUTH_CURRENT_PATH"), pid)
    auth_override = _resolve_process_path(env.get("CODEX_AUTH_JSON_PATH"), pid)
    has_explicit_auth_scope_env = (
        "CODEX_AUTH_CURRENT_PATH" in env or "CODEX_AUTH_JSON_PATH" in env
    )
    if has_explicit_auth_scope_env or _has_runtime_scoped_auth_paths(
        current_override=current_override,
        auth_override=auth_override,
        default_current_path=default_current_path,
        default_auth_path=default_auth_path,
    ):
        snapshot_from_current = _read_current_snapshot_name(
            current_override if current_override is not None else default_current_path
        )
        if snapshot_from_current:
            return snapshot_from_current

        return _infer_snapshot_name_from_auth_path(
            auth_override if auth_override is not None else default_auth_path
        )

    return None


def _has_runtime_scoped_auth_paths(
    *,
    current_override: Path | None,
    auth_override: Path | None,
    default_current_path: Path,
    default_auth_path: Path,
) -> bool:
    if current_override is not None and current_override != default_current_path:
        return True
    if auth_override is not None and auth_override != default_auth_path:
        return True
    return False


def _read_current_snapshot_name(current_path: Path | None) -> str | None:
    if current_path is None or not current_path.exists() or not current_path.is_file():
        return None
    try:
        value = current_path.read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None
    return value or None


def _infer_snapshot_name_from_auth_path(auth_path: Path | None) -> str | None:
    if auth_path is None:
        return None

    candidate = auth_path
    if candidate.is_symlink():
        try:
            candidate = candidate.resolve()
        except OSError:
            pass

    if candidate.suffix != ".json":
        return None
    if candidate.name == "auth.json":
        return None
    return candidate.stem or None


def _iter_running_codex_commands(proc_root: Path) -> list[tuple[int, list[str]]]:
    running: list[tuple[int, list[str]]] = []
    for entry in proc_root.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        command = _read_process_cmdline(pid)
        if not command:
            continue
        if _is_codex_session_command(command):
            running.append((pid, command))
    return running


def _read_process_cmdline(pid: int) -> list[str]:
    cmdline_path = Path("/proc") / str(pid) / "cmdline"
    try:
        raw = cmdline_path.read_bytes()
    except OSError:
        return []
    if not raw:
        return []
    parts = [chunk.decode("utf-8", errors="ignore") for chunk in raw.split(b"\x00") if chunk]
    return [part for part in parts if part]


def _is_codex_session_command(command: list[str]) -> bool:
    if not command:
        return False

    has_codex_binary = any(Path(part).name == "codex" for part in command[:3])
    if not has_codex_binary:
        return False

    return any("model_instructions_file=" in part for part in command)


def _is_non_default_auth_scope_process(
    pid: int,
    *,
    default_current_path: Path,
    default_auth_path: Path,
) -> bool:
    env = _read_process_env(pid)
    if not env:
        return False

    current_override = _resolve_process_path(env.get("CODEX_AUTH_CURRENT_PATH"), pid)
    auth_override = _resolve_process_path(env.get("CODEX_AUTH_JSON_PATH"), pid)

    if current_override is not None and current_override != default_current_path:
        return True
    if auth_override is not None and auth_override != default_auth_path:
        return True
    return False


def _read_process_env(pid: int) -> dict[str, str]:
    environ_path = Path("/proc") / str(pid) / "environ"
    try:
        raw = environ_path.read_bytes()
    except OSError:
        return {}

    parsed: dict[str, str] = {}
    for entry in raw.split(b"\x00"):
        if not entry or b"=" not in entry:
            continue
        key, value = entry.split(b"=", 1)
        parsed[key.decode("utf-8", errors="ignore")] = value.decode("utf-8", errors="ignore")
    return parsed


def _resolve_process_path(raw_value: str | None, pid: int) -> Path | None:
    if not raw_value:
        return None

    candidate = Path(raw_value).expanduser()
    if candidate.is_absolute():
        try:
            return candidate.resolve()
        except OSError:
            return candidate

    cwd = _read_process_cwd(pid)
    if cwd is not None:
        candidate = cwd / candidate
    try:
        return candidate.resolve()
    except OSError:
        return candidate


def _read_process_cwd(pid: int) -> Path | None:
    cwd_link = Path("/proc") / str(pid) / "cwd"
    try:
        return Path(os.readlink(cwd_link)).resolve()
    except OSError:
        return None


def _candidate_rollout_files(sessions_dir: Path, now: datetime) -> list[Path]:
    aware_now = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    results: list[Path] = []

    for offset_days in range(2):
        day = (aware_now - timedelta(days=offset_days)).date()
        day_dir = sessions_dir / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
        if not day_dir.exists() or not day_dir.is_dir():
            continue
        for path in day_dir.glob("rollout-*.jsonl"):
            if path.is_file():
                results.append(path)

    if results:
        return sorted(results, key=_safe_mtime, reverse=True)

    fallback = sorted(sessions_dir.rglob("rollout-*.jsonl"), key=_safe_mtime, reverse=True)
    return [path for path in fallback[:_FALLBACK_SCAN_LIMIT] if path.is_file()]


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _extract_latest_rate_limit_from_paths(
    paths: list[Path],
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    for path in paths:
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is not None:
            return snapshot
    return None


def _extract_max_used_rate_limit_from_paths(
    paths: list[Path],
    *,
    now: datetime,
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
    snapshots: list[tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None]] = []
    for path in paths:
        snapshot = _extract_latest_rate_limit_from_file(path)
        if snapshot is not None:
            snapshots.append(snapshot)

    if not snapshots:
        return None

    snapshots.sort(key=lambda item: item[0], reverse=True)
    latest_recorded_at = snapshots[0][0]
    merged_primary: LocalUsageWindow | None = None
    merged_secondary: LocalUsageWindow | None = None

    for recorded_at, primary, secondary in snapshots:
        merged_primary = _merge_usage_windows(
            previous=merged_primary,
            current=primary,
            preferred_recorded_at=latest_recorded_at,
            fallback_recorded_at=recorded_at,
            now=now,
            prefer_max_used_within_cycle=True,
        )
        merged_secondary = _merge_usage_windows(
            previous=merged_secondary,
            current=secondary,
            preferred_recorded_at=latest_recorded_at,
            fallback_recorded_at=recorded_at,
            now=now,
            prefer_max_used_within_cycle=True,
        )

    return latest_recorded_at, merged_primary, merged_secondary


def _extract_latest_rate_limit_from_file(
    path: Path,
) -> tuple[datetime, LocalUsageWindow | None, LocalUsageWindow | None] | None:
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

        rate_limits = _extract_rate_limits_payload(payload)
        if rate_limits is None:
            continue

        timestamp = _parse_timestamp(payload.get("timestamp"))
        if timestamp is None:
            continue

        primary_raw, secondary_raw = _extract_windows(rate_limits)
        primary = _window_from_payload(primary_raw, timestamp)
        secondary = _window_from_payload(secondary_raw, timestamp)
        return timestamp, primary, secondary

    return None


def _extract_rate_limits_payload(payload: dict[str, Any]) -> dict[str, Any] | None:
    event_payload = payload.get("payload")
    if isinstance(event_payload, dict):
        event_type = event_payload.get("type")
        if event_type == "token_count":
            rate_limits = event_payload.get("rate_limits") or event_payload.get("rate_limit")
            if isinstance(rate_limits, dict):
                return rate_limits
        direct_rate_limits = event_payload.get("rate_limits")
        if isinstance(direct_rate_limits, dict):
            return direct_rate_limits

    direct = payload.get("rate_limits")
    if isinstance(direct, dict):
        return direct
    return None


def _extract_windows(rate_limits: dict[str, Any]) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    primary = rate_limits.get("primary")
    secondary = rate_limits.get("secondary")
    if not isinstance(primary, dict):
        primary = rate_limits.get("primary_window") if isinstance(rate_limits.get("primary_window"), dict) else None
    if not isinstance(secondary, dict):
        secondary = (
            rate_limits.get("secondary_window") if isinstance(rate_limits.get("secondary_window"), dict) else None
        )
    return primary, secondary


def _window_from_payload(window: dict[str, Any] | None, timestamp: datetime) -> LocalUsageWindow | None:
    if not isinstance(window, dict):
        return None
    used_percent = _to_float(window.get("used_percent"))
    if used_percent is None:
        return None

    reset_at = _to_int(window.get("resets_at")) or _to_int(window.get("reset_at"))
    window_minutes = _to_int(window.get("window_minutes"))
    if window_minutes is None:
        limit_window_seconds = _to_int(window.get("window_seconds")) or _to_int(window.get("limit_window_seconds"))
        if limit_window_seconds and limit_window_seconds > 0:
            window_minutes = limit_window_seconds // 60

    if reset_at is None:
        reset_after_seconds = _to_int(window.get("reset_after_seconds"))
        if reset_after_seconds is not None and reset_after_seconds > 0:
            reset_at = int(timestamp.timestamp()) + reset_after_seconds

    return LocalUsageWindow(
        used_percent=used_percent,
        reset_at=reset_at,
        window_minutes=window_minutes,
    )


def _merge_usage_windows(
    *,
    previous: LocalUsageWindow | None,
    current: LocalUsageWindow | None,
    preferred_recorded_at: datetime,
    fallback_recorded_at: datetime,
    now: datetime,
    prefer_max_used_within_cycle: bool,
) -> LocalUsageWindow | None:
    if previous is None:
        return current
    if current is None:
        return previous

    preferred_window = previous if preferred_recorded_at >= fallback_recorded_at else current
    fallback_window = current if preferred_window is previous else previous
    now_ts = int(now.timestamp())

    preferred_reset = preferred_window.reset_at
    fallback_reset = fallback_window.reset_at

    if (
        prefer_max_used_within_cycle
        and preferred_reset is not None
        and fallback_reset is not None
    ):
        preferred_is_current_cycle = preferred_reset > now_ts
        fallback_is_current_cycle = fallback_reset > now_ts

        if preferred_is_current_cycle and not fallback_is_current_cycle:
            return preferred_window
        if fallback_is_current_cycle and not preferred_is_current_cycle:
            return fallback_window

        same_cycle = abs(preferred_reset - fallback_reset) <= _RESET_AT_MATCH_TOLERANCE_SECONDS
        same_window = (
            preferred_window.window_minutes is not None
            and fallback_window.window_minutes is not None
            and preferred_window.window_minutes == fallback_window.window_minutes
        )
        if same_cycle or same_window:
            if fallback_window.used_percent > preferred_window.used_percent:
                return fallback_window
            return preferred_window

    return preferred_window


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _to_float(value: Any) -> float | None:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return None
    return None


def _to_int(value: Any) -> int | None:
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
