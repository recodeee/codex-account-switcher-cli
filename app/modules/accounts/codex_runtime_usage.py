from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from app.modules.accounts.codex_auth_switcher import build_snapshot_index
from app.modules.accounts.codex_live_usage import (
    _read_default_scope_rollout_paths_by_snapshot_from_live_processes,
)


@dataclass(frozen=True)
class LocalCodexRuntimeUsageSummary:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    session_count: int = 0


def read_local_codex_runtime_usage_summary_by_snapshot(
    *,
    now: datetime | None = None,
    days: int = 90,
) -> dict[str, LocalCodexRuntimeUsageSummary]:
    current = now or datetime.now(timezone.utc)
    normalized_days = max(1, int(days))

    totals_by_snapshot: dict[str, _MutableSummary] = {}
    scanned_rollout_paths: set[Path] = set()

    default_scope_rollout_state = _read_default_scope_rollout_paths_by_snapshot_from_live_processes()
    if default_scope_rollout_state.rollout_paths_by_snapshot:
        for snapshot_name, rollout_paths in default_scope_rollout_state.rollout_paths_by_snapshot.items():
            default_totals = _scan_rollout_paths(
                rollout_paths=rollout_paths,
                scanned_rollout_paths=scanned_rollout_paths,
            )
            if default_totals.session_count <= 0:
                continue
            totals_by_snapshot.setdefault(snapshot_name, _MutableSummary()).merge(default_totals)
    elif not default_scope_rollout_state.has_mapped_processes:
        active_snapshot_name = build_snapshot_index().active_snapshot_name
        if active_snapshot_name:
            default_sessions_dir = _resolve_default_sessions_dir()
            default_totals = _scan_rollout_sessions(
                sessions_dir=default_sessions_dir,
                now=current,
                days=normalized_days,
                scanned_rollout_paths=scanned_rollout_paths,
            )
            if default_totals.session_count > 0:
                totals_by_snapshot.setdefault(active_snapshot_name, _MutableSummary()).merge(default_totals)

    runtime_root = _resolve_runtime_root()
    if runtime_root.exists() and runtime_root.is_dir():
        for runtime_dir in runtime_root.iterdir():
            if not runtime_dir.is_dir():
                continue
            snapshot_name = _read_runtime_current_snapshot(runtime_dir)
            if not snapshot_name:
                continue
            runtime_sessions_dir = runtime_dir / "sessions"
            runtime_totals = _scan_rollout_sessions(
                sessions_dir=runtime_sessions_dir,
                now=current,
                days=normalized_days,
                scanned_rollout_paths=scanned_rollout_paths,
            )
            if runtime_totals.session_count <= 0:
                continue
            totals_by_snapshot.setdefault(snapshot_name, _MutableSummary()).merge(runtime_totals)

    return {
        snapshot_name: LocalCodexRuntimeUsageSummary(
            input_tokens=max(0, summary.input_tokens),
            output_tokens=max(0, summary.output_tokens),
            cache_read_tokens=max(0, summary.cache_read_tokens),
            cache_write_tokens=max(0, summary.cache_write_tokens),
            session_count=max(0, summary.session_count),
        )
        for snapshot_name, summary in totals_by_snapshot.items()
    }


@dataclass
class _MutableSummary:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    session_count: int = 0

    def merge(self, other: "_MutableSummary") -> None:
        self.input_tokens += other.input_tokens
        self.output_tokens += other.output_tokens
        self.cache_read_tokens += other.cache_read_tokens
        self.cache_write_tokens += other.cache_write_tokens
        self.session_count += other.session_count


def _scan_rollout_sessions(
    *,
    sessions_dir: Path,
    now: datetime,
    days: int,
    scanned_rollout_paths: set[Path] | None = None,
) -> _MutableSummary:
    if not sessions_dir.exists() or not sessions_dir.is_dir():
        return _MutableSummary()

    return _scan_rollout_paths(
        rollout_paths=_iter_recent_rollout_files(sessions_dir=sessions_dir, now=now, days=days),
        scanned_rollout_paths=scanned_rollout_paths,
    )


def _scan_rollout_paths(
    *,
    rollout_paths: list[Path],
    scanned_rollout_paths: set[Path] | None = None,
) -> _MutableSummary:
    summary = _MutableSummary()
    for rollout_path in rollout_paths:
        normalized_path = _normalize_path(rollout_path)
        if scanned_rollout_paths is not None and normalized_path in scanned_rollout_paths:
            continue

        usage = _extract_latest_token_usage(rollout_path)
        if usage is None:
            continue
        if scanned_rollout_paths is not None:
            scanned_rollout_paths.add(normalized_path)
        summary.session_count += 1
        summary.input_tokens += usage.input_tokens
        summary.output_tokens += usage.output_tokens
        summary.cache_read_tokens += usage.cache_read_tokens
        summary.cache_write_tokens += usage.cache_write_tokens
    return summary


def _normalize_path(path: Path) -> Path:
    try:
        return path.resolve()
    except OSError:
        return path


@dataclass(frozen=True)
class _TokenUsage:
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_write_tokens: int


def _extract_latest_token_usage(path: Path) -> _TokenUsage | None:
    latest: _TokenUsage | None = None
    try:
        with path.open("r", encoding="utf-8", errors="ignore") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or '"token_count"' not in line:
                    continue
                usage = _token_usage_from_line(line)
                if usage is None:
                    continue
                latest = usage
    except OSError:
        return None
    return latest


def _token_usage_from_line(line: str) -> _TokenUsage | None:
    try:
        payload = json.loads(line)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, dict):
        return None

    event_payload = payload.get("payload")
    if not isinstance(event_payload, dict):
        return None
    if event_payload.get("type") != "token_count":
        return None

    info = event_payload.get("info")
    if not isinstance(info, dict):
        return None

    usage_payload = info.get("total_token_usage")
    if not isinstance(usage_payload, dict):
        usage_payload = info.get("last_token_usage")
    if not isinstance(usage_payload, dict):
        return None

    input_tokens = _to_int(usage_payload.get("input_tokens"))
    output_tokens = _to_int(usage_payload.get("output_tokens"))
    reasoning_output_tokens = _to_int(usage_payload.get("reasoning_output_tokens"))
    cached_input_tokens = _to_int(usage_payload.get("cached_input_tokens"))
    cache_read_input_tokens = _to_int(usage_payload.get("cache_read_input_tokens"))
    cache_write_tokens = _to_int(usage_payload.get("cache_write_tokens"))
    cache_write_input_tokens = _to_int(usage_payload.get("cache_write_input_tokens"))

    output_sum = max(0, output_tokens)
    if output_sum <= 0:
        output_sum = max(0, reasoning_output_tokens)
    cache_read = max(0, cached_input_tokens or cache_read_input_tokens)
    cache_write = max(0, cache_write_tokens or cache_write_input_tokens)

    return _TokenUsage(
        input_tokens=max(0, input_tokens),
        output_tokens=max(0, output_sum),
        cache_read_tokens=max(0, cache_read),
        cache_write_tokens=max(0, cache_write),
    )


def _to_int(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return 0
        try:
            return int(float(raw))
        except ValueError:
            return 0
    return 0


def _iter_recent_rollout_files(*, sessions_dir: Path, now: datetime, days: int) -> list[Path]:
    aware_now = now if now.tzinfo is not None else now.replace(tzinfo=timezone.utc)
    discovered: dict[Path, None] = {}

    for offset in range(days):
        day = (aware_now - timedelta(days=offset)).date()
        day_dir = sessions_dir / f"{day.year:04d}" / f"{day.month:02d}" / f"{day.day:02d}"
        if not day_dir.exists() or not day_dir.is_dir():
            continue
        for path in day_dir.glob("rollout-*.jsonl"):
            if path.is_file():
                discovered[path.resolve()] = None

    if discovered:
        return sorted(discovered.keys(), key=_safe_mtime, reverse=True)

    fallback = sorted(sessions_dir.rglob("rollout-*.jsonl"), key=_safe_mtime, reverse=True)
    return [path.resolve() for path in fallback[:200] if path.is_file()]


def _safe_mtime(path: Path) -> float:
    try:
        return path.stat().st_mtime
    except OSError:
        return 0.0


def _resolve_default_home_path() -> Path:
    raw_home = os.environ.get("HOME")
    if raw_home:
        return Path(raw_home).expanduser().resolve()
    return Path.home().resolve()


def _resolve_default_sessions_dir() -> Path:
    sessions_raw = os.environ.get("CODEX_SESSIONS_DIR")
    if sessions_raw:
        return Path(sessions_raw).expanduser().resolve()

    auth_raw = os.environ.get("CODEX_AUTH_JSON_PATH")
    if auth_raw:
        return Path(auth_raw).expanduser().resolve().parent / "sessions"

    return (_resolve_default_home_path() / ".codex" / "sessions").resolve()


def _resolve_runtime_root() -> Path:
    raw = os.environ.get("CODEX_AUTH_RUNTIME_ROOT")
    if raw:
        return Path(raw).expanduser().resolve()
    return (_resolve_default_home_path() / ".codex" / "runtimes").resolve()


def _read_runtime_current_snapshot(runtime_dir: Path) -> str | None:
    current_path = runtime_dir / "current"
    try:
        raw_value = current_path.read_text(encoding="utf-8", errors="ignore").strip()
    except OSError:
        return None
    return raw_value or None
