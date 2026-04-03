from __future__ import annotations

import json
import os
import re
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.modules.accounts.codex_auth_switcher import build_snapshot_index


_DEFAULT_ACTIVE_WINDOW_SECONDS = 1800
_TAIL_LINE_LIMIT = 400
_FALLBACK_SCAN_LIMIT = 200
_ROLLOUT_SESSION_PREFIX_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$")


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
        )
        if runtime_usage is None:
            continue

        previous = usage_by_snapshot.get(snapshot_name)
        usage_by_snapshot[snapshot_name] = _merge_live_usage(previous, runtime_usage)

    return usage_by_snapshot


def _read_local_codex_live_usage_for_sessions_dir(
    *,
    sessions_dir: Path,
    now: datetime,
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
        samples.append(
            LocalCodexLiveUsage(
                recorded_at=recorded_at,
                active_session_count=1,
                primary=primary,
                secondary=secondary,
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
        primary=preferred.primary if preferred.primary is not None else fallback.primary,
        secondary=preferred.secondary if preferred.secondary is not None else fallback.secondary,
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


def _read_runtime_current_snapshot(runtime_dir: Path) -> str | None:
    current_path = runtime_dir / "current"
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
